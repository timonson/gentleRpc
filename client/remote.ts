import { Client as HttpClient } from "./http.ts";
import { Client as WsClient } from "./ws.ts";
import { BadServerDataError } from "./error.ts";

import type { JsonArray, RpcRequest } from "../json_rpc_types.ts";

export type Resource = string | URL | Request;

type HttpProxyFunction = {
  (
    params?: RpcRequest["params"],
  ): ReturnType<HttpClient["call"]>;
  notify: (
    params?: RpcRequest["params"],
  ) => ReturnType<HttpClient["call"]>;
  auth: (
    jwt: string,
  ) => (params?: RpcRequest["params"]) => ReturnType<HttpClient["call"]>;
  batch: (
    params: RpcRequest["params"][],
    isNotification?: boolean,
  ) => Promise<JsonArray | undefined>;
};

type HttpProxy = {
  [method: string]: HttpProxyFunction;
} & { batch: HttpClient["batch"] };

type WsProxyFunction = {
  (
    params?: RpcRequest["params"],
  ): ReturnType<WsClient["call"]>;
  notify: (
    params?: RpcRequest["params"],
  ) => ReturnType<WsClient["call"]>;
  subscribe: () => ReturnType<WsClient["subscribe"]>;
  listen: () => ReturnType<WsClient["listen"]>;
};

type WsProxy =
  & {
    [method: string]: WsProxyFunction;
  }
  & { socket: WebSocket };

const httpProxyHandler = {
  get(client: HttpClient, name: RpcRequest["method"]) {
    if (client[name as keyof HttpClient] !== undefined) {
      return client[name as keyof HttpClient];
    } else {
      const proxyFunction: HttpProxyFunction = (args?) =>
        client.call(name, args);
      proxyFunction.notify = (args?) =>
        client.call(name, args, { isNotification: true });
      proxyFunction.auth = (jwt) => (args?) => client.call(name, args, { jwt });
      proxyFunction.batch = (args, isNotification = false) =>
        client.batch([name, ...args], isNotification);
      return proxyFunction;
    }
  },
};

const wsProxyHandler = {
  get(client: WsClient, name: RpcRequest["method"]) {
    if (
      client[name as keyof WsClient] !== undefined || name === "then"
    ) {
      return client[name as keyof WsClient];
    } else {
      const proxyFunction: WsProxyFunction = (args?) => client.call(name, args);
      proxyFunction.notify = (args?) => client.call(name, args, true);
      proxyFunction.subscribe = () => client.subscribe(name);
      proxyFunction.listen = () => client.listen(name);
      return proxyFunction;
    }
  },
};

function listen(socket: WebSocket): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    socket.onopen = () => resolve(socket);
    socket.onerror = (err) => reject(err);
  });
}

export function createRemote(
  resource: Resource,
  options?: RequestInit,
): HttpProxy;
export function createRemote(
  socket: WebSocket,
): Promise<WsProxy>;
export function createRemote(
  resourceOrSocket: Resource | WebSocket,
  options?: RequestInit,
) {
  if (resourceOrSocket instanceof WebSocket) {
    return listen(resourceOrSocket)
      .then((socket) =>
        new Proxy<WsProxy>(
          new WsClient(socket),
          wsProxyHandler,
        )
      )
      .catch((err) =>
        Promise.reject(
          new BadServerDataError(
            null,
            "An error event occured on the WebSocket connection.",
            -32005,
            err.stack,
          ),
        )
      );
  } else {
    return new Proxy<HttpProxy>(
      new HttpClient(resourceOrSocket, options),
      httpProxyHandler,
    );
  }
}
