export const CONVERSION_TRANSITION_CONFLICT = "conversion_transition_conflict";
export const EARNING_TRANSITION_CONFLICT = "earning_transition_conflict";

export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonDetails = Readonly<Record<string, JsonValue>>;

export interface DomainConflictErrorOptions {
  readonly code: string;
  readonly message: string;
  readonly details: JsonDetails;
}

/**
 * A domain-rule violation that can be safely mapped to an HTTP conflict response.
 * Details are restricted to plain JSON values so no persistence model is retained
 * or accidentally serialized into an API response.
 */
export class DomainConflictError extends Error {
  readonly code: string;
  readonly details: JsonDetails;

  constructor({ code, message, details }: DomainConflictErrorOptions) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);

    this.name = "DomainConflictError";
    this.code = code;
    this.details = cloneJsonDetails(details);
  }
}

function cloneJsonDetails(details: JsonDetails): JsonDetails {
  return Object.freeze(cloneJsonObject(details, new Set()));
}

function cloneJsonObject(
  value: { readonly [key: string]: JsonValue },
  ancestors: Set<object>,
): Record<string, JsonValue> {
  if (!isPlainObject(value)) {
    throw new TypeError("details must contain only JSON-safe values");
  }
  if (ancestors.has(value)) {
    throw new TypeError("details must contain only JSON-safe values");
  }

  ancestors.add(value);
  const result: Record<string, JsonValue> = {};
  try {
    for (const [key, nestedValue] of Object.entries(value)) {
      Object.defineProperty(result, key, {
        configurable: false,
        enumerable: true,
        value: cloneJsonValue(nestedValue, ancestors),
        writable: false,
      });
    }
  } finally {
    ancestors.delete(value);
  }

  return result;
}

function cloneJsonValue(value: JsonValue, ancestors: Set<object>): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("details must contain only JSON-safe values");
    }
    return value;
  }

  if (isJsonArray(value)) {
    if (ancestors.has(value)) {
      throw new TypeError("details must contain only JSON-safe values");
    }

    ancestors.add(value);
    try {
      return Object.freeze(value.map((item) => cloneJsonValue(item, ancestors)));
    } finally {
      ancestors.delete(value);
    }
  }

  return Object.freeze(cloneJsonObject(value, ancestors));
}

function isPlainObject(value: unknown): value is { readonly [key: string]: JsonValue } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype: object | null = Reflect.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}
