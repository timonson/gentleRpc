// https://www.jsonrpc.org/specification

export type RpcVersion = "2.0";
export type RpcReservedMethod = string;
export type RpcId = number | string | null;
export type RpcParams = JsonArray | JsonObject;
export type RpcMethod = string;

export interface RpcNotification {
  jsonrpc: RpcVersion;
  method: RpcMethod;
  params?: RpcParams;
}

export interface RpcRequest extends RpcNotification {
  id?: RpcId;
}

export type RpcResponse = RpcSuccess | RpcFailure;

export type RpcBatchRequest = RpcRequest[];
export type RpcBatchResponse = RpcResponse[];

export type RpcResponseOrBatch = RpcResponse | RpcBatchResponse;

export interface RpcResponseBasis {
  jsonrpc: RpcVersion;
  id: RpcId;
}

export interface RpcSuccess extends RpcResponseBasis {
  result: JsonValue;
}

export interface RpcFailure extends RpcResponseBasis {
  error: RpcError;
}

export interface RpcError {
  code: number;
  message: string;
  data?: JsonValue;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export type JsonObject = { [member: string]: JsonValue };
export type JsonArray = JsonValue[];
