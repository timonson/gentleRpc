import { cleanBatch, createResponseObject } from "./creation.ts";
import { validateRequest, validateRpcRequestObject } from "./validation.ts";
import { isWebSocketCloseEvent, isWebSocketPingEvent } from "./deps.ts";

import type { CreationInput } from "./creation.ts";
import type { WebSocket } from "./deps.ts";

export type MethodsAndIdsStore = Map<string, Set<string>>;
type Input = Omit<CreationInput, "validationObject"> & { socket: WebSocket } & {
  methodsAndIdsStore: MethodsAndIdsStore;
};
type Emission = {
  method: string;
  params: unknown;
};

function partialEmitListener(
  { socket, methods, options, methodsAndIdsStore }: Input,
) {
  return async function emitListener(event: CustomEvent) {
    const { method, params } = event.detail as Emission;
    if (methodsAndIdsStore.has(method)) {
      const ids = [...methodsAndIdsStore.get(method)!.values()];
      return ids.map(async (id) => {
        const response = await createResponseObject({
          validationObject: validateRpcRequestObject(
            { method, params, id, jsonrpc: "2.0" },
            methods,
          ),
          methods,
          options,
        });
        if (response) {
          try {
            return await socket.send(JSON.stringify(response));
          } catch {
            removeEventListener("emit", emitListener as EventListener);
          }
        }
      });
    }
  };
}

export async function handleWs(
  { socket, methods, options, methodsAndIdsStore }: Input,
) {
  console.log("socket connected!");

  const emitListener = partialEmitListener({
    socket,
    methods,
    options,
    methodsAndIdsStore,
  });
  if (!options.disableInternalMethods) {
    addEventListener("emit", emitListener as EventListener);
  }

  try {
    for await (const ev of socket) {
      if (typeof ev === "string") {
        // console.log("ws:Text", ev);
        const validationObjectOrBatch = validateRequest(ev, methods);
        const responseObjectOrBatchOrNull =
          Array.isArray(validationObjectOrBatch)
            ? await cleanBatch(
              validationObjectOrBatch.map(async (validationObject) =>
                await createResponseObject(
                  { validationObject, methods, options },
                )
              ),
            )
            : await createResponseObject(
              {
                validationObject: validationObjectOrBatch,
                methods,
                options,
              },
            );
        if (responseObjectOrBatchOrNull) {
          await socket.send(JSON.stringify(responseObjectOrBatchOrNull));
        }
      } else if (isWebSocketPingEvent(ev)) {
        const [, body] = ev;
        console.log("ws:Ping", body);
      } else if (isWebSocketCloseEvent(ev)) {
        const { code, reason } = ev;
        console.log("ws:Close", code, reason);
        if (!options.disableInternalMethods) {
          removeEventListener("emit", emitListener as EventListener);
        }
      }
    }
  } catch (err) {
    console.error(`failed to receive frame: ${err}`);
    if (!options.disableInternalMethods) {
      removeEventListener("emit", emitListener as EventListener);
    }
    if (!socket.isClosed) {
      await socket.close(1000).catch((err) => console.error(err));
    }
  }
}