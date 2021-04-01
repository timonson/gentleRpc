import { createRequest } from "./creation.ts";
import { validateResponse, validateRpcNotification } from "./validation.ts";
import { BadServerDataError } from "./error.ts";

import type { JsonValue, RpcRequest } from "../json_rpc_types.ts";

function isObject(obj: unknown): obj is Record<string, unknown> {
  return (
    obj !== null && typeof obj === "object" && Array.isArray(obj) === false
  );
}

export class Client {
  private textDecoder?: TextDecoder;
  private payloadData!: Promise<any>;
  socket: WebSocket;
  [key: string]: any // necessary for es6 proxy
  constructor(
    socket: WebSocket,
  ) {
    this.socket = socket;
    this.getPayloadData(socket);
  }

  private async getPayloadData(socket: WebSocket): Promise<any> {
    this.payloadData = new Promise((resolve, reject) => {
      socket.onmessage = async (event: MessageEvent) => {
        let msg: string;
        if (event.data instanceof Blob) {
          msg = this.getTextDecoder().decode(await event.data.arrayBuffer());
        } else if (event.data instanceof ArrayBuffer) {
          msg = this.getTextDecoder().decode(event.data);
        } else {
          msg = event.data;
        }
        resolve(msg);
      };
      socket.onclose = () => resolve(null);
    });
    await this.payloadData;
    if (socket.readyState > 1) return this.payloadData;
    return this.getPayloadData(socket);
  }

  private getTextDecoder(): TextDecoder {
    return this.textDecoder || (this.textDecoder = new TextDecoder());
  }

  private async *iterateOverPayloadData(
    rpcRequest: RpcRequest,
    { isOnetime }: { isOnetime: boolean },
  ): AsyncGenerator<JsonValue> {
    while (this.socket.readyState < 2) {
      try {
        const payloadData = await this.payloadData;
        if (payloadData === null) {
          break;
        }
        const parsedData = JSON.parse(payloadData);

        // for the method emitBatch
        if (Array.isArray(parsedData) && !isOnetime && parsedData.length > 0) {
          const invalid = parsedData.map(validateResponse).find((res) =>
            !isObject(res.result) || res.result.event !== "emitted"
          );
          if (invalid) {
            throw new BadServerDataError(
              invalid.id ? invalid.id : null,
              "The server returned an invalid batch response.",
              -32004,
            );
          } else {
            continue;
          }
        } else {
          const rpcResponse = validateResponse(parsedData);
          if (
            !isOnetime &&
            isObject(rpcResponse.result) &&
            rpcResponse.result.id === rpcRequest.id
          ) {
            if (
              rpcResponse.result.event === "subscribed" ||
              rpcResponse.result.event === "emitted"
            ) {
              continue;
            }
            if (rpcResponse.result.event === "unsubscribed") {
              break;
            }
          }
          if (rpcResponse.id === rpcRequest.id) {
            yield rpcResponse.result;
            if (isOnetime) {
              break;
            }
          }
        }
      } catch (err) {
        if (err.id === rpcRequest.id) {
          yield Promise.reject(err);
          if (isOnetime) {
            break;
          }
        }
      }
    }
  }

  private async *iterateNotifications(
    eventName: RpcRequest["method"],
  ): AsyncGenerator<JsonValue> {
    while (this.socket.readyState < 2) {
      const payloadData = await this.payloadData;
      if (payloadData === null) {
        break;
      }
      const parsedData = JSON.parse(payloadData);

      if (validateRpcNotification(parsedData)) {
        const rpcNotification = parsedData;
        if (rpcNotification.method === eventName) {
          yield rpcNotification.params || null;
        }
      }
    }
  }

  call(
    method: RpcRequest["method"],
    params: RpcRequest["params"],
    isNotification = false,
  ): Promise<JsonValue | undefined> {
    const rpcRequest = createRequest({
      method,
      params,
      isNotification,
    });
    this.socket.send(JSON.stringify(
      rpcRequest,
    ));
    if (isNotification) return Promise.resolve(undefined);
    const generator = this.iterateOverPayloadData(rpcRequest, {
      isOnetime: true,
    });
    return generator.next().then((p) => p.value);
  }

  subscribe(
    method: RpcRequest["method"],
  ) {
    const rpcRequest = createRequest({
      method: "subscribe",
    });
    this.socket.send(JSON.stringify(
      {
        ...rpcRequest,
        params: { method, id: rpcRequest.id as string },
      },
    ));
    return {
      generator: this.iterateOverPayloadData(rpcRequest, {
        isOnetime: false,
      }),
      unsubscribe: (params?: RpcRequest["params"]): void => {
        const rpcRequestUnsubscription = createRequest({
          method: "unsubscribe",
          params: { method, id: rpcRequest.id as string },
        });
        return this.socket.send(JSON.stringify(
          rpcRequestUnsubscription,
        ));
      },
      emit: (params?: RpcRequest["params"]): void => {
        return this.socket.send(JSON.stringify(
          {
            ...rpcRequest,
            method: "emit",
            params: { method, params, id: rpcRequest.id as string },
          },
        ));
      },
      emitBatch: (params: RpcRequest["params"][]): void => {
        return this.socket.send(JSON.stringify(params.map((p) => (
          {
            ...rpcRequest,
            method: "emit",
            params: { method, params: p, id: rpcRequest.id as string },
          }
        ))));
      },
    };
  }

  listen(
    eventName: RpcRequest["method"],
  ) {
    return {
      generator: this.iterateNotifications(eventName),
    };
  }
}
