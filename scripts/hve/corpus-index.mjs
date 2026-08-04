import { createHash, createPublicKey, sign, verify } from "node:crypto";

/**
 * Stable JSON is used for the evaluator-signed part of a corpus index.  It is
 * deliberately tiny and rejects values JSON would otherwise silently coerce
 * (undefined, NaN, functions), so the bytes signed by the evaluator are the
 * exact facts verified by the release gate.
 */
export function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Corpus index cannot contain a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (typeof value === "object") {
    const object = value;
    return `{${Object.keys(object).sort().map((key) => {
      const child = object[key];
      if (child === undefined) throw new TypeError(`Corpus index contains undefined at ${key}`);
      return `${JSON.stringify(key)}:${canonicalJson(child)}`;
    }).join(",")}}`;
  }
  throw new TypeError(`Corpus index cannot contain ${typeof value}`);
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** The signature is intentionally outside the payload that it signs. */
export function unsignedCorpusIndex(index) {
  const unsigned = { ...index };
  delete unsigned.signature;
  return unsigned;
}

export function corpusIndexPayload(index) {
  return Buffer.from(canonicalJson(unsignedCorpusIndex(index)), "utf8");
}

export function publicKeyFingerprint(privateKey) {
  const publicKey = createPublicKey(privateKey).export({ type: "spki", format: "pem" });
  return {
    pem: publicKey,
    fingerprint: sha256(publicKey),
  };
}

export function fingerprintPublicKey(publicKey) {
  const normalized = createPublicKey(publicKey).export({ type: "spki", format: "pem" });
  return sha256(normalized);
}

export function signCorpusIndex(unsignedIndex, privateKey) {
  const key = publicKeyFingerprint(privateKey);
  return {
    ...unsignedIndex,
    signature: {
      algorithm: "ed25519",
      keyFingerprint: key.fingerprint,
      value: sign(null, corpusIndexPayload(unsignedIndex), privateKey).toString("base64"),
    },
  };
}

export function verifyCorpusIndex(index, publicKey) {
  if (index?.signature?.algorithm !== "ed25519" || typeof index.signature.value !== "string") return false;
  const signature = Buffer.from(index.signature.value, "base64");
  if (!signature.length) return false;
  try {
    if (typeof index.signature.keyFingerprint !== "string" || index.signature.keyFingerprint !== fingerprintPublicKey(publicKey)) {
      return false;
    }
    return verify(null, corpusIndexPayload(index), publicKey, signature);
  } catch {
    return false;
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function hasRequiredKeys(value, required) {
  return [...required].every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function validRange(value, durationUs) {
  return isRecord(value)
    && Number.isSafeInteger(value.startUs)
    && Number.isSafeInteger(value.endUs)
    && value.startUs >= 0
    && value.endUs > value.startUs
    && value.endUs <= durationUs;
}

/**
 * A signed hash says that an annotation file was not substituted; it says
 * nothing about whether it is useful ground truth. This small strict parser is
 * intentionally run by the evaluator while it has the private object bytes.
 * It mirrors the checked-in JSON schema without adding a general-purpose JSON
 * schema runtime to the production app.
 */
export function validateAnnotationForItem(value, item) {
  const errors = [];
  if (!isRecord(value)) return ["annotation must be an object"];
  const annotationKeys = new Set(["schemaVersion", "itemId", "timebase", "licenseRef", "annotation", "activeSpeaker", "ranges"]);
  const requiredAnnotationKeys = new Set(["schemaVersion", "itemId", "timebase", "licenseRef", "annotation", "ranges"]);
  if (!hasOnlyKeys(value, annotationKeys) || !hasRequiredKeys(value, requiredAnnotationKeys)) {
    errors.push("annotation has unknown top-level fields");
  }
  if (value.schemaVersion !== 1) errors.push("schemaVersion must equal 1");
  if (value.itemId !== item.itemId) errors.push("itemId does not match manifest item");
  if (value.timebase !== "microseconds") errors.push("timebase must be microseconds");
  if (value.licenseRef !== item.licenseRef) errors.push("licenseRef does not match manifest item");
  const provenanceKeys = new Set(["annotators", "adjudicator", "sealed"]);
  if (!isRecord(value.annotation) || !hasOnlyKeys(value.annotation, provenanceKeys) || !hasRequiredKeys(value.annotation, provenanceKeys)) {
    errors.push("annotation provenance is malformed");
  } else {
    if (!Array.isArray(value.annotation.annotators) || value.annotation.annotators.length === 0
      || value.annotation.annotators.some((annotator) => typeof annotator !== "string" || annotator.length < 2)) {
      errors.push("annotation requires at least one valid annotator");
    }
    if (!(typeof value.annotation.adjudicator === "string" || value.annotation.adjudicator === null)) errors.push("annotation adjudicator is malformed");
    if (typeof value.annotation.sealed !== "boolean") errors.push("annotation sealed flag is malformed");
  }
  if (!Array.isArray(value.ranges) || value.ranges.length === 0) {
    errors.push("annotation requires ranges");
    return errors;
  }
  const annotationRanges = [];
  for (const [index, range] of value.ranges.entries()) {
    const label = `ranges[${index}]`;
    const rangeKeys = new Set([
      "rangeId", "startUs", "endUs", "contentType", "preferredLayouts", "acceptableLayouts", "forbiddenLayouts", "constraints",
    ]);
    if (!isRecord(range) || !hasOnlyKeys(range, rangeKeys) || !hasRequiredKeys(range, rangeKeys)) {
      errors.push(`${label} has unknown or missing fields`);
      continue;
    }
    if (typeof range.rangeId !== "string" || range.rangeId.length < 2) errors.push(`${label}.rangeId is malformed`);
    if (!validRange(range, item.durationUs)) errors.push(`${label} is outside the source duration`);
    if (typeof range.contentType !== "string" || range.contentType.length < 2) errors.push(`${label}.contentType is malformed`);
    for (const field of ["preferredLayouts", "acceptableLayouts", "forbiddenLayouts"]) {
      if (!Array.isArray(range[field]) || range[field].some((layout) => typeof layout !== "string" || !layout)) {
        errors.push(`${label}.${field} is malformed`);
      }
    }
    if (!Array.isArray(range.acceptableLayouts) || range.acceptableLayouts.length === 0) errors.push(`${label}.acceptableLayouts must not be empty`);
    const constraintKeys = new Set(["mustKeepRegionIds", "safeZoneIds", "activeSpeakerRegionId", "regionRoles"]);
    const requiredConstraintKeys = new Set(["mustKeepRegionIds", "safeZoneIds"]);
    if (!isRecord(range.constraints) || !hasOnlyKeys(range.constraints, constraintKeys) || !hasRequiredKeys(range.constraints, requiredConstraintKeys)) {
      errors.push(`${label}.constraints is malformed`);
    } else {
      for (const field of ["mustKeepRegionIds", "safeZoneIds"]) {
        if (!Array.isArray(range.constraints[field]) || range.constraints[field].some((id) => typeof id !== "string" || !id)) {
          errors.push(`${label}.constraints.${field} is malformed`);
        }
      }
      if (!(typeof range.constraints.activeSpeakerRegionId === "string" || range.constraints.activeSpeakerRegionId === undefined || range.constraints.activeSpeakerRegionId === null)) {
        errors.push(`${label}.constraints.activeSpeakerRegionId is malformed`);
      }
      // This remains optional for a generic corpus. HVE-G6 requires it when
      // evaluating screen/gameplay/panel ranges: a bare region ID cannot
      // prove whether a candidate preserved the screen or a facecam.
      if (range.constraints.regionRoles !== undefined) {
        const allowedRoles = new Set(["screen", "gameplay", "face", "facecam"]);
        if (!isRecord(range.constraints.regionRoles)
          || Object.entries(range.constraints.regionRoles).some(([id, role]) => (
            !id || typeof role !== "string" || !allowedRoles.has(role)
          ))) {
          errors.push(`${label}.constraints.regionRoles is malformed`);
        }
      }
    }
    if (validRange(range, item.durationUs)) annotationRanges.push({ startUs: range.startUs, endUs: range.endUs });
  }
  for (let index = 1; index < annotationRanges.length; index += 1) {
    const current = annotationRanges[index];
    const previous = annotationRanges[index - 1];
    if (current && previous && (current.startUs < previous.startUs || current.startUs < previous.endUs)) {
      errors.push("annotation ranges must be sorted and non-overlapping");
      break;
    }
  }
  for (const range of item.evaluationRanges ?? []) {
    if (!annotationRanges.some((annotationRange) => annotationRange.startUs <= range.startUs && annotationRange.endUs >= range.endUs)) {
      errors.push(`evaluation range ${range.startUs}-${range.endUs} is not covered by annotation ground truth`);
    }
  }

  // HVE-G5 has a deliberately separate, optional annotation extension.  A
  // general layout corpus is not forced to label speakers, while an
  // active-speaker corpus is rejected later unless every evaluated item has
  // this exact, adjudicated ground truth.  Labels use semantic region IDs,
  // never detector track IDs, so a candidate cannot win by choosing its own
  // identity names.
  if (Object.prototype.hasOwnProperty.call(value, "activeSpeaker")) {
    const activeSpeaker = value.activeSpeaker;
    const activeSpeakerKeys = new Set(["schemaVersion", "stratum", "turns"]);
    if (!isRecord(activeSpeaker) || !hasOnlyKeys(activeSpeaker, activeSpeakerKeys) || !hasRequiredKeys(activeSpeaker, activeSpeakerKeys)) {
      errors.push("activeSpeaker has unknown or missing fields");
    } else {
      if (activeSpeaker.schemaVersion !== 1) errors.push("activeSpeaker.schemaVersion must equal 1");
      if (!(activeSpeaker.stratum === "clean_two_person" || activeSpeaker.stratum === "panel_hard")) {
        errors.push("activeSpeaker.stratum is malformed");
      }
      if (!Array.isArray(activeSpeaker.turns) || activeSpeaker.turns.length === 0) {
        errors.push("activeSpeaker.turns must not be empty");
      } else {
        const turnKeys = new Set(["turnId", "startUs", "endUs", "speakerId", "faceRegionId"]);
        const turnIds = new Set();
        const activeTurns = [];
        for (const [index, turn] of activeSpeaker.turns.entries()) {
          const label = `activeSpeaker.turns[${index}]`;
          if (!isRecord(turn) || !hasOnlyKeys(turn, turnKeys) || !hasRequiredKeys(turn, turnKeys)) {
            errors.push(`${label} has unknown or missing fields`);
            continue;
          }
          if (typeof turn.turnId !== "string" || turn.turnId.length < 2 || turnIds.has(turn.turnId)) errors.push(`${label}.turnId is malformed or duplicated`);
          turnIds.add(turn.turnId);
          if (!validRange(turn, item.durationUs)) {
            errors.push(`${label} is outside the source duration`);
            continue;
          }
          if (typeof turn.speakerId !== "string" || !turn.speakerId) errors.push(`${label}.speakerId is malformed`);
          if (!(typeof turn.faceRegionId === "string" && turn.faceRegionId.length > 0) && turn.faceRegionId !== null) {
            errors.push(`${label}.faceRegionId is malformed`);
          }
          activeTurns.push({ startUs: turn.startUs, endUs: turn.endUs });
        }
        for (let index = 1; index < activeTurns.length; index += 1) {
          const previous = activeTurns[index - 1];
          const current = activeTurns[index];
          if (previous && current && (current.startUs < previous.startUs || current.startUs < previous.endUs)) {
            errors.push("activeSpeaker.turns must be sorted and non-overlapping");
            break;
          }
        }
      }
    }
  }
  return errors;
}
