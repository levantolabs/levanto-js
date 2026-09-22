/** Sage v1.1 response bodies from the docs (identical to levanto-py tests/samples.py). */

export const META = {
  "model": "levanto-sage-v1.1",
  "latency_ms": 97.4
} as const;

export const REASONING_META = {
  "fired": true,
  "ran": true,
  "finished": true,
  "tokens": 312,
  "margin": 1.4,
  "limited": null
} as const;

export const YESNO = {
  "id": "needs_review",
  "kind": "yesno",
  "result": {
    "answer": "yes",
    "probability": 0.92
  },
  "meta": {
    "model": "levanto-sage-v1.1",
    "latency_ms": 97.4
  }
} as const;

export const YESNO_UNSURE = {
  "id": "needs_review",
  "kind": "yesno",
  "result": {
    "answer": null,
    "probability": 0.51
  },
  "meta": {
    "model": "levanto-sage-v1.1",
    "latency_ms": 97.4
  }
} as const;

export const YESNO_REASONED = {
  "id": "refund_ok",
  "kind": "yesno",
  "result": {
    "answer": "no",
    "probability": 0.06
  },
  "meta": {
    "model": "levanto-sage-v1.1",
    "latency_ms": 1840.0,
    "reasoning": {
      "fired": true,
      "ran": true,
      "finished": true,
      "tokens": 312,
      "margin": 1.4,
      "limited": null
    }
  }
} as const;

export const CHOICE = {
  "id": "disposition",
  "kind": "choice",
  "result": {
    "chosen": "revise",
    "probability": 0.88,
    "probabilities": [
      {
        "option": "approve",
        "probability": 0.11
      },
      {
        "option": "revise",
        "probability": 0.88
      },
      {
        "option": "reject",
        "probability": 0.04
      }
    ]
  },
  "meta": {
    "model": "levanto-sage-v1.1",
    "latency_ms": 97.4
  }
} as const;

export const CHOICE_UNSURE = {
  "id": "disposition",
  "kind": "choice",
  "result": {
    "chosen": null,
    "probability": null,
    "probabilities": [
      {
        "option": "approve",
        "probability": 0.71
      },
      {
        "option": "revise",
        "probability": 0.68
      }
    ]
  },
  "meta": {
    "model": "levanto-sage-v1.1",
    "latency_ms": 97.4
  }
} as const;

export const SCALE = {
  "id": "harm",
  "kind": "scale",
  "result": {
    "expectation": 3.1,
    "confidence": 0.82
  },
  "meta": {
    "model": "levanto-sage-v1.1",
    "latency_ms": 97.4
  }
} as const;

export const SORT = {
  "id": "triage",
  "kind": "sort",
  "result": {
    "sorted": [
      "db_down",
      "pricing",
      "typo"
    ],
    "confidence": 0.92
  },
  "meta": {
    "model": "levanto-sage-v1.1",
    "latency_ms": 97.4
  }
} as const;

export const SORT_NO_CONFIDENCE = {
  "id": "triage",
  "kind": "sort",
  "result": {
    "sorted": [
      "b",
      "a"
    ],
    "confidence": null
  },
  "meta": {
    "model": "levanto-sage-v1.1",
    "latency_ms": 97.4
  }
} as const;

export const TAGS = {
  "id": "tools",
  "kind": "tags",
  "result": {
    "tags": [
      {
        "id": "summary",
        "probability": 0.97,
        "applies": true
      },
      {
        "id": "outline",
        "probability": 0.04,
        "applies": false
      },
      {
        "id": "quiz",
        "probability": 0.49,
        "applies": null
      }
    ]
  },
  "meta": {
    "model": "levanto-sage-v1.1",
    "latency_ms": 97.4
  }
} as const;

export const IMAGE_YESNO = {
  "id": "shows_bug",
  "kind": "yesno",
  "result": {
    "answer": "yes",
    "probability": 0.93
  },
  "meta": {
    "model": "levanto-sage-v1.1",
    "latency_ms": 412.0,
    "usage": {
      "billed_input_tokens": 16,
      "image_count": 1,
      "image_tokens": 850
    }
  }
} as const;

export const GROUNDED = {
  "id": "needs_review",
  "kind": "yesno",
  "result": {
    "answer": "yes",
    "probability": 0.92
  },
  "meta": {
    "model": "levanto-sage-v1.1",
    "latency_ms": 97.4
  },
  "grounding_meta": {
    "triggered": true,
    "trigger_reason": "low_confidence",
    "queries": [
      "cloudflare incident september"
    ],
    "sources": [
      {
        "url": "https://example.com",
        "title": "Status",
        "snippet": "..."
      }
    ],
    "added_context_tokens": 640,
    "search_ms": 812.0
  }
} as const;

export const SINGLES: Record<string, readonly unknown[]> = {
  YesNoDecideResponsePublic: [YESNO, YESNO_UNSURE, YESNO_REASONED, IMAGE_YESNO, GROUNDED],
  ChoiceDecideResponsePublic: [CHOICE, CHOICE_UNSURE],
  ScaleDecideResponsePublic: [SCALE],
  SortDecideResponsePublic: [SORT, SORT_NO_CONFIDENCE],
  TagsDecideResponsePublic: [TAGS],
};

/** A /decide/batch body: each group is a list of envelopes (ok) or error strings (failed). */
export function batch(...groups: Array<Array<unknown>>) {
  return {
    results: groups.map((g) => ({
      answers: g.map((a) => (typeof a === 'string' ? { ok: false, result: null, error: a } : { ok: true, result: a })),
    })),
    meta: {
      model: 'levanto-sage-v1.1',
      request_count: groups.length,
      question_count: groups.reduce((n, g) => n + g.length, 0),
      latency_ms: 150.0,
    },
  };
}

/** A valid 8x8 solid-blue PNG. */
export const PNG_BLUE = Uint8Array.from(Buffer.from('89504e470d0a1a0a0000000d49484452000000080000000808020000004b6d29dc0000001449444154789c6314b1b8c2800d3061151db41200e5080130ff196aff0000000049454e44ae426082', 'hex'));
