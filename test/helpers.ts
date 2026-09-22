/**
 * Test helpers: a recording fake `fetch`, and validation against the Sage v1.1
 * OpenAPI spec in test/data/openapi.json. Request validation is closed-world:
 * a field the spec doesn't define fails the test.
 */
import Ajv2020 from 'ajv/dist/2020';
import spec from './data/openapi.json';
import { LevantoClient, type LevantoClientOptions } from '../src';

export const SPEC = spec as { info: { version: string }; components: { schemas: Record<string, unknown> } };

function closed(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(closed);
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) out[k] = closed(v);
    if (out.type === 'object' && 'properties' in out && !('additionalProperties' in out)) out.additionalProperties = false;
    return out;
  }
  return node;
}

function validator(doc: unknown) {
  const ajv = new Ajv2020({ strict: false, allErrors: true, validateSchema: false });
  ajv.addSchema(doc as object, 'https://sage.levanto.ai/openapi.json');
  return (schema: string, body: unknown) => {
    const validate = ajv.getSchema(`https://sage.levanto.ai/openapi.json#/components/schemas/${schema}`) ?? ajv.compile({ $ref: `https://sage.levanto.ai/openapi.json#/components/schemas/${schema}` });
    return validate(body) ? [] : (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`);
  };
}

const strict = validator(closed(spec));
const open = validator(spec);

export function requestErrors(body: unknown, schema: string): string[] {
  return strict(schema, body);
}

export function expectValidRequest(body: unknown, schema: string): void {
  const errors = strict(schema, body);
  if (errors.length) throw new Error(`invalid ${schema}:\n${errors.join('\n')}\n${JSON.stringify(body)}`);
}

export function expectValidResponse(body: unknown, schema: string): void {
  const errors = open(schema, body);
  if (errors.length) throw new Error(`invalid ${schema}:\n${errors.join('\n')}`);
}

type Reply = [status: number, body?: unknown, headers?: Record<string, string>] | Error;

/** A fake `fetch` that records requests and answers from a queue (the last reply repeats). */
export class Recorder {
  readonly requests: Array<{ url: string; init: RequestInit }> = [];
  private readonly replies: Reply[];

  constructor(...replies: Reply[]) {
    this.replies = replies.length ? replies : [[200, {}]];
  }

  readonly fetch = async (url: string, init: RequestInit): Promise<Response> => {
    this.requests.push({ url, init });
    const reply = this.replies.length > 1 ? this.replies.shift()! : this.replies[0];
    if (reply instanceof Error) throw reply;
    const [status, body, headers] = reply;
    const text = typeof body === 'string' ? body : JSON.stringify(body ?? {});
    return new Response(text, { status, headers: { 'content-type': 'application/json', ...headers } });
  };

  get body(): any {
    return JSON.parse(String(this.requests.at(-1)!.init.body));
  }

  get headers(): Record<string, string> {
    return this.requests.at(-1)!.init.headers as Record<string, string>;
  }
}

export function client(rec: Recorder, opts: LevantoClientOptions = {}): LevantoClient {
  return new LevantoClient({ apiKey: 'lv_test_key', maxRetries: 0, fetch: rec.fetch, ...opts });
}
