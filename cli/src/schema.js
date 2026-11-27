export const SCENARIO_SCHEMA = {
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://raw.githubusercontent.com/nishanthn99/queueflux/main/schemas/v1/scenario.json",
  "title": "QueueFlux Scenario",
  "description": "A complete description of a virtual-time queue simulation experiment.",
  "type": "object",
  "required": ["schemaVersion", "name", "durationMicros", "seed", "queues", "workerPools", "workloads"],
  "additionalProperties": false,
  "properties": {
    "schemaVersion": { "type": "integer", "enum": [1] },
    "name": { "type": "string", "minLength": 1 },
    "durationMicros": { "type": "integer", "minimum": 1 },
    "seed": { "type": "integer" },
    "queues": {
      "type": "array",
      "minItems": 1,
      "items": { "$ref": "#/definitions/QueueDefinition" }
    },
    "workerPools": {
      "type": "array",
      "minItems": 1,
      "items": { "$ref": "#/definitions/WorkerPoolDefinition" }
    },
    "workloads": {
      "type": "array",
      "minItems": 1,
      "items": { "$ref": "#/definitions/WorkloadDefinition" }
    }
  },
  "definitions": {
    "QueueDefinition": {
      "type": "object",
      "required": ["id", "maxDepth", "discipline"],
      "additionalProperties": false,
      "properties": {
        "id": { "type": "string", "minLength": 1 },
        "maxDepth": { "type": "integer", "minimum": 1 },
        "discipline": { "type": "string", "enum": ["FIFO", "PRIORITY"] },
        "retryPolicy": { "$ref": "#/definitions/RetryPolicy" },
        "rateLimit": { "$ref": "#/definitions/RateLimitPolicy" }
      }
    },
    "RetryPolicy": {
      "type": "object",
      "required": ["maxAttempts", "initialBackoffMicros", "maxBackoffMicros", "multiplier"],
      "additionalProperties": false,
      "properties": {
        "maxAttempts": { "type": "integer", "minimum": 1, "maximum": 100 },
        "initialBackoffMicros": { "type": "integer", "minimum": 0 },
        "maxBackoffMicros": { "type": "integer", "minimum": 0 },
        "multiplier": { "type": "number", "minimum": 1 },
        "jitterFraction": { "type": "number", "minimum": 0, "maximum": 1 }
      }
    },
    "RateLimitPolicy": {
      "type": "object",
      "required": ["ratePerSecond", "burstCapacity"],
      "additionalProperties": false,
      "properties": {
        "ratePerSecond": { "type": "number", "minimum": 0 },
        "burstCapacity": { "type": "integer", "minimum": 1 }
      }
    },
    "WorkerPoolDefinition": {
      "type": "object",
      "required": ["id", "queueId", "workerCount", "concurrencyPerWorker", "serviceTime"],
      "additionalProperties": false,
      "properties": {
        "id": { "type": "string", "minLength": 1 },
        "queueId": { "type": "string", "minLength": 1 },
        "workerCount": { "type": "integer", "minimum": 1 },
        "concurrencyPerWorker": { "type": "integer", "minimum": 1 },
        "serviceTime": { "$ref": "#/definitions/ServiceTimeModel" },
        "failureProbability": { "type": "number", "minimum": 0, "maximum": 1 },
        "outages": {
          "type": "array",
          "items": { "$ref": "#/definitions/WorkerOutage" }
        }
      }
    },
    "ServiceTimeModel": {
      "type": "object",
      "required": ["distribution"],
      "properties": {
        "distribution": { "type": "string", "enum": ["CONSTANT", "EXPONENTIAL", "LOGNORMAL"] },
        "constantMicros": { "type": "integer", "minimum": 1 },
        "meanMicros": { "type": "number", "exclusiveMinimum": 0 },
        "stdDevMicros": { "type": "number", "exclusiveMinimum": 0 }
      },
      "allOf": [
        {
          "if": {
            "properties": { "distribution": { "const": "CONSTANT" } },
            "required": ["distribution"]
          },
          "then": { "required": ["constantMicros"] }
        },
        {
          "if": {
            "properties": { "distribution": { "const": "EXPONENTIAL" } },
            "required": ["distribution"]
          },
          "then": { "required": ["meanMicros"] }
        },
        {
          "if": {
            "properties": { "distribution": { "const": "LOGNORMAL" } },
            "required": ["distribution"]
          },
          "then": { "required": ["meanMicros", "stdDevMicros"] }
        }
      ]
    },
    "WorkerOutage": {
      "type": "object",
      "required": ["id", "startMicros", "endMicros", "unavailableWorkers"],
      "additionalProperties": false,
      "properties": {
        "id": { "type": "string", "minLength": 1 },
        "startMicros": { "type": "integer", "minimum": 0 },
        "endMicros": { "type": "integer", "minimum": 0 },
        "unavailableWorkers": { "type": "integer", "minimum": 1 }
      }
    },
    "WorkloadDefinition": {
      "type": "object",
      "required": ["id", "queueId", "startMicros", "endMicros", "arrivals"],
      "additionalProperties": false,
      "properties": {
        "id": { "type": "string", "minLength": 1 },
        "queueId": { "type": "string", "minLength": 1 },
        "startMicros": { "type": "integer", "minimum": 0 },
        "endMicros": { "type": "integer", "minimum": 0 },
        "priority": { "type": "integer" },
        "arrivals": { "$ref": "#/definitions/ArrivalModel" }
      }
    },
    "ArrivalModel": {
      "type": "object",
      "required": ["mode", "ratePerSecond"],
      "additionalProperties": false,
      "properties": {
        "mode": { "type": "string", "enum": ["CONSTANT", "POISSON"] },
        "ratePerSecond": { "type": "number", "exclusiveMinimum": 0 }
      }
    }
  }
};
