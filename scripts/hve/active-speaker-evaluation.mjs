import { canonicalJson, sha256 } from "./corpus-index.mjs";

/**
 * Pure evaluator for the HVE-G5 active-speaker corpus.
 *
 * It intentionally works on compact, evaluator-owned labels and association
 * artifacts only.  Neither decoded frames, transcripts, face embeddings nor
 * model logits are accepted here.  This makes an evaluation report portable
 * while preventing the release control plane from becoming a second media
 * processing system.
 */

const FACE_NONE = null;
const MAX_SWITCH_OBSERVATION_US = 5_000_000;
const SWITCH_STABILITY_US = 200_000;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isHash(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function ratio(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function percentile(values, quantile) {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const position = Math.min(ordered.length - 1, Math.max(0, Math.ceil(quantile * ordered.length) - 1));
  return ordered[position] ?? null;
}

function overlap(left, right) {
  return Math.max(0, Math.min(left.endUs, right.endUs) - Math.max(left.startUs, right.startUs));
}

function contains(range, atUs) {
  return range.startUs <= atUs && atUs < range.endUs;
}

function noOverlaps(items, label) {
  const sorted = [...items].sort((left, right) => left.startUs - right.startUs || left.endUs - right.endUs);
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (previous && current && current.startUs < previous.endUs) {
      throw new Error(`${label} contains overlapping intervals`);
    }
  }
}

function validateLabelBundle(bundle, manifest, objectIndex) {
  if (!isRecord(bundle) || bundle.schemaVersion !== 1 || bundle.kind !== "hve-active-speaker-labels-v1") {
    throw new Error("labels must be a signed hve-active-speaker-labels-v1 bundle");
  }
  if (!Array.isArray(bundle.items)) throw new Error("labels.items must be an array");
  if (bundle.corpusVersion !== manifest.corpusVersion) throw new Error("labels corpusVersion does not match manifest");
  if (!isHash(objectIndex.manifestSha256) || bundle.manifestSha256 !== objectIndex.manifestSha256) {
    throw new Error("labels manifestSha256 does not bind the exact manifest");
  }
  if (bundle.objectIndexSha256 !== sha256(canonicalJson(objectIndex))) throw new Error("labels objectIndexSha256 does not bind the exact object index");
  if (bundle.evaluatorKeyFingerprint !== objectIndex?.signature?.keyFingerprint) {
    throw new Error("labels evaluator key does not match the signed object index");
  }

  const manifestItems = new Map(manifest.items.map((item) => [item.itemId, item]));
  const labelsByItem = new Map();
  for (const item of bundle.items) {
    if (!isRecord(item) || typeof item.itemId !== "string" || !isRecord(item.annotation)) {
      throw new Error("labels.items entries must contain itemId and annotation");
    }
    if (labelsByItem.has(item.itemId)) throw new Error(`labels contains duplicate ${item.itemId}`);
    const manifestItem = manifestItems.get(item.itemId);
    if (!manifestItem) throw new Error(`labels references unknown corpus item ${item.itemId}`);
    if (item.annotationSha256 !== manifestItem.annotationSha256 || item.annotationSha256 !== objectIndex.objects?.[manifestItem.annotationKey]?.sha256) {
      throw new Error(`labels annotation hash does not match signed corpus for ${item.itemId}`);
    }
    const active = item.annotation.activeSpeaker;
    if (!isRecord(active) || active.schemaVersion !== 1 || !["clean_two_person", "panel_hard"].includes(active.stratum) || !Array.isArray(active.turns) || !active.turns.length) {
      throw new Error(`labels.${item.itemId} lacks HVE-G5 active-speaker ground truth`);
    }
    const turns = active.turns.map((turn, index) => {
      if (!isRecord(turn)
        || typeof turn.turnId !== "string"
        || !positiveInteger(turn.endUs)
        || !Number.isSafeInteger(turn.startUs)
        || turn.startUs < 0
        || turn.endUs <= turn.startUs
        || typeof turn.speakerId !== "string"
        || !turn.speakerId
        || !(typeof turn.faceRegionId === "string" || turn.faceRegionId === null)
        || turn.endUs > manifestItem.durationUs) {
        throw new Error(`labels.${item.itemId}.activeSpeaker.turns[${index}] is invalid`);
      }
      return turn;
    });
    noOverlaps(turns, `labels.${item.itemId}.activeSpeaker.turns`);
    labelsByItem.set(item.itemId, { ...item, activeSpeaker: { ...active, turns } });
  }
  return { manifestItems, labelsByItem };
}

function validatePredictions(predictions, manifest, objectIndex, labelsByItem) {
  if (!isRecord(predictions) || predictions.schemaVersion !== 1 || predictions.kind !== "hve-active-speaker-predictions-v1") {
    throw new Error("predictions must be a hve-active-speaker-predictions-v1 bundle");
  }
  if (!Array.isArray(predictions.items)) throw new Error("predictions.items must be an array");
  if (predictions.corpusVersion !== manifest.corpusVersion) throw new Error("predictions corpusVersion does not match manifest");
  if (!isHash(objectIndex.manifestSha256) || predictions.manifestSha256 !== objectIndex.manifestSha256) {
    throw new Error("predictions manifestSha256 does not bind the exact manifest");
  }
  if (predictions.objectIndexSha256 !== sha256(canonicalJson(objectIndex))) throw new Error("predictions objectIndexSha256 does not bind the exact object index");
  if (predictions.evaluatorKeyFingerprint !== objectIndex?.signature?.keyFingerprint) {
    throw new Error("predictions evaluator key does not match the signed object index");
  }
  if (!isRecord(predictions.candidate) || !isRecord(predictions.hardware)) {
    throw new Error("predictions requires candidate and hardware provenance");
  }
  const requiredCandidateStrings = ["diarizationEngine", "diarizationModelVersion", "mouthEngine", "mouthModelVersion", "associationCodeSha256"];
  for (const field of requiredCandidateStrings) {
    const value = predictions.candidate[field];
    if (field.endsWith("Sha256") ? !isHash(value) : typeof value !== "string" || value.length < 2) {
      throw new Error(`predictions.candidate.${field} is invalid`);
    }
  }
  for (const field of ["diarizationModelSha256", "mouthModelSha256"]) {
    if (!isHash(predictions.candidate[field])) throw new Error(`predictions.candidate.${field} is invalid`);
  }
  if (predictions.hardware.profile !== "timeweb-cpu8-12gb" || !positiveInteger(predictions.hardware.cpuCount) || !positiveInteger(predictions.hardware.memoryBytes)) {
    throw new Error("predictions.hardware must identify the Timeweb CPU8/12GB evaluator profile");
  }

  const predictionByItem = new Map();
  for (const item of predictions.items) {
    if (!isRecord(item) || typeof item.itemId !== "string" || typeof item.sourceHash !== "string" || !Array.isArray(item.links) || !isRecord(item.evaluatorMappings) || !isRecord(item.measurement)) {
      throw new Error("predictions.items entries are malformed");
    }
    if (predictionByItem.has(item.itemId)) throw new Error(`predictions contains duplicate ${item.itemId}`);
    const labelled = labelsByItem.get(item.itemId);
    if (!labelled) throw new Error(`predictions contains unlabelled corpus item ${item.itemId}`);
    const manifestItem = manifest.items.find((entry) => entry.itemId === item.itemId);
    if (!manifestItem || !isHash(item.sourceHash) || item.sourceHash.toLowerCase() !== manifestItem.sha256.toLowerCase()) {
      throw new Error(`predictions.${item.itemId}.sourceHash does not bind the corpus media object`);
    }
    const links = item.links.map((link, index) => {
      if (!isRecord(link)
        || typeof link.speakerId !== "string"
        || !link.speakerId
        || !Number.isSafeInteger(link.startUs)
        || !positiveInteger(link.endUs)
        || link.startUs < 0
        || link.endUs <= link.startUs
        || link.endUs > manifestItem.durationUs
        || !(typeof link.faceTrackId === "string" || link.faceTrackId === null)
        || !ratio(link.confidence)
        || !["audio_video_association", "offscreen", "insufficient_evidence"].includes(link.reason)) {
        throw new Error(`predictions.${item.itemId}.links[${index}] is invalid`);
      }
      if (link.reason === "audio_video_association" && !link.faceTrackId) throw new Error(`predictions.${item.itemId}.links[${index}] cannot associate a missing face`);
      if (link.reason !== "audio_video_association" && link.faceTrackId !== null) throw new Error(`predictions.${item.itemId}.links[${index}] fallback cannot claim a face`);
      return link;
    });
    // Each predicted diarized speaker must be temporal, not a stack of
    // mutually incompatible assignments. Cross-speaker overlap is allowed
    // but is scored as ambiguous on the evaluator clock.
    for (const speakerId of new Set(links.map((link) => link.speakerId))) {
      noOverlaps(links.filter((link) => link.speakerId === speakerId), `predictions.${item.itemId}.${speakerId}`);
    }
    for (const [predictedSpeakerId, goldSpeakerId] of Object.entries(item.evaluatorMappings.speakers)) {
      if (typeof predictedSpeakerId !== "string" || typeof goldSpeakerId !== "string") throw new Error(`predictions.${item.itemId} has malformed speaker map`);
    }
    for (const [predictedFaceId, goldFaceId] of Object.entries(item.evaluatorMappings.faces)) {
      if (typeof predictedFaceId !== "string" || typeof goldFaceId !== "string") throw new Error(`predictions.${item.itemId} has malformed face map`);
    }
    for (const field of ["peakRssBytes", "sustainedSwapBytes", "wallSeconds", "mediaSeconds", "coldStartSeconds"]) {
      const value = item.measurement[field];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`predictions.${item.itemId}.measurement.${field} is invalid`);
    }
    predictionByItem.set(item.itemId, { ...item, links });
  }
  for (const itemId of labelsByItem.keys()) {
    if (!predictionByItem.has(itemId)) throw new Error(`predictions are missing labelled item ${itemId}`);
  }
  return predictionByItem;
}

function labelForLink(link, mapping) {
  if (link.faceTrackId === null) return FACE_NONE;
  return mapping.faces[link.faceTrackId] ?? `__unmapped:${link.faceTrackId}`;
}

function candidateLinksAt(links, atUs, expectedSpeakerId, mappings) {
  const containing = links.filter((link) => contains(link, atUs));
  const intended = containing.filter((link) => mappings.speakers[link.speakerId] === expectedSpeakerId);
  if (intended.length === 1) return intended[0];
  // A tied/multi-speaker prediction is deliberately interpreted as no stable
  // assignment. Picking the higher confidence person would hide exactly the
  // diarization ambiguity that active-speaker must safely surface.
  if (intended.length > 1 || containing.length > 1) return null;
  return containing[0] ?? null;
}

function evaluationBreakpoints(turn, links) {
  const points = new Set([turn.startUs, turn.endUs]);
  for (const link of links) {
    if (overlap(turn, link) > 0) {
      points.add(Math.max(turn.startUs, link.startUs));
      points.add(Math.min(turn.endUs, link.endUs));
    }
  }
  return [...points].sort((left, right) => left - right);
}

function accumulateTurn(turn, links, mappings, counters) {
  const points = evaluationBreakpoints(turn, links);
  for (let index = 1; index < points.length; index += 1) {
    const startUs = points[index - 1];
    const endUs = points[index];
    if (startUs === undefined || endUs === undefined || endUs <= startUs) continue;
    const durationUs = endUs - startUs;
    const prediction = candidateLinksAt(links, startUs, turn.speakerId, mappings);
    const actual = prediction ? labelForLink(prediction, mappings) : FACE_NONE;
    const expected = turn.faceRegionId;
    counters.totalUs += durationUs;
    if (expected === FACE_NONE) {
      counters.offscreenUs += durationUs;
      if (actual !== FACE_NONE) {
        counters.falseOffscreenAssignmentUs += durationUs;
        counters.fpUs += durationUs;
      }
      continue;
    }
    counters.visibleUs += durationUs;
    if (actual === expected) {
      counters.tpUs += durationUs;
    } else {
      counters.fnUs += durationUs;
      if (actual !== FACE_NONE) counters.fpUs += durationUs;
    }
  }
}

function switchLatencyUs(previous, current, links, mappings) {
  if (previous.faceRegionId === current.faceRegionId || current.faceRegionId === FACE_NONE) return null;
  const deadline = Math.min(current.endUs, current.startUs + MAX_SWITCH_OBSERVATION_US);
  const boundaries = new Set([current.startUs, deadline]);
  for (const link of links) {
    if (link.startUs >= current.startUs && link.startUs < deadline) boundaries.add(link.startUs);
    if (link.endUs > current.startUs && link.endUs <= deadline) boundaries.add(link.endUs);
  }
  const ordered = [...boundaries].sort((left, right) => left - right);
  for (const candidateStart of ordered) {
    const prediction = candidateLinksAt(links, candidateStart, current.speakerId, mappings);
    if (!prediction || labelForLink(prediction, mappings) !== current.faceRegionId) continue;
    const stableUntil = Math.min(deadline, prediction.endUs);
    if (stableUntil - candidateStart >= SWITCH_STABILITY_US) return candidateStart - current.startUs;
  }
  return MAX_SWITCH_OBSERVATION_US;
}

function emptyCounters() {
  return {
    items: 0,
    samples: 0,
    totalUs: 0,
    visibleUs: 0,
    offscreenUs: 0,
    falseOffscreenAssignmentUs: 0,
    tpUs: 0,
    fpUs: 0,
    fnUs: 0,
    switchLatenciesUs: [],
    unresolvedSwitches: 0,
  };
}

function publicStratumMetrics(counters) {
  const denominator = (2 * counters.tpUs) + counters.fpUs + counters.fnUs;
  return {
    items: counters.items,
    samples: counters.samples,
    activeSpeakerF1: denominator === 0 ? 0 : Number(((2 * counters.tpUs) / denominator).toFixed(6)),
    visibleSpeakerCoverage: counters.visibleUs === 0 ? 0 : Number((counters.tpUs / counters.visibleUs).toFixed(6)),
    evaluatedDurationUs: counters.totalUs,
    switches: counters.switchLatenciesUs.length,
    unresolvedSwitches: counters.unresolvedSwitches,
  };
}

/**
 * Computes HVE-G5 report metrics from exact signed corpus labels plus an
 * evaluator-owned prediction bundle. The caller must verify both signatures
 * before invoking this function; the CLI below does so.
 */
export function evaluateActiveSpeaker({ manifest, objectIndex, labels, predictions, generatedAt = new Date().toISOString() }) {
  if (!isRecord(manifest) || !Array.isArray(manifest.items) || !isRecord(objectIndex) || !isRecord(objectIndex.objects)) {
    throw new Error("manifest and signed object index are required");
  }
  const { labelsByItem } = validateLabelBundle(labels, manifest, objectIndex);
  const predictionByItem = validatePredictions(predictions, manifest, objectIndex, labelsByItem);
  const strata = new Map([["clean_two_person", emptyCounters()], ["panel_hard", emptyCounters()]]);
  const all = emptyCounters();
  const rss = [];
  const swaps = [];
  const itemFailures = [];

  for (const [itemId, label] of labelsByItem) {
    const prediction = predictionByItem.get(itemId);
    const counters = strata.get(label.activeSpeaker.stratum);
    if (!prediction || !counters) throw new Error(`unable to evaluate ${itemId}`);
    const itemCounters = emptyCounters();
    itemCounters.items += 1;
    counters.items += 1;
    all.items += 1;
    for (const turn of label.activeSpeaker.turns) {
      itemCounters.samples += 1;
      counters.samples += 1;
      all.samples += 1;
      accumulateTurn(turn, prediction.links, prediction.evaluatorMappings, itemCounters);
      accumulateTurn(turn, prediction.links, prediction.evaluatorMappings, counters);
      accumulateTurn(turn, prediction.links, prediction.evaluatorMappings, all);
    }
    for (let index = 1; index < label.activeSpeaker.turns.length; index += 1) {
      const latency = switchLatencyUs(label.activeSpeaker.turns[index - 1], label.activeSpeaker.turns[index], prediction.links, prediction.evaluatorMappings);
      if (latency === null) continue;
      itemCounters.switchLatenciesUs.push(latency);
      counters.switchLatenciesUs.push(latency);
      all.switchLatenciesUs.push(latency);
      if (latency >= MAX_SWITCH_OBSERVATION_US) {
        itemCounters.unresolvedSwitches += 1;
        counters.unresolvedSwitches += 1;
        all.unresolvedSwitches += 1;
      }
    }
    const itemMetrics = publicStratumMetrics(itemCounters);
    if (itemMetrics.activeSpeakerF1 < 0.5 || itemCounters.falseOffscreenAssignmentUs > 0) {
      itemFailures.push({ itemId, stratum: label.activeSpeaker.stratum, ...itemMetrics });
    }
    rss.push(prediction.measurement.peakRssBytes);
    swaps.push(prediction.measurement.sustainedSwapBytes);
  }

  const perStratum = Object.fromEntries([...strata.entries()].map(([name, counters]) => [name, publicStratumMetrics(counters)]));
  const p95LatencyUs = percentile(all.switchLatenciesUs, 0.95);
  const report = {
    schemaVersion: 1,
    kind: "hve-active-speaker-benchmark-v1",
    // This only means the evaluator completed deterministically. The separate
    // promotion validator applies frozen acceptance thresholds.
    status: "pass",
    generatedAt,
    corpus: {
      version: manifest.corpusVersion,
      manifestSha256: objectIndex.manifestSha256,
      signedObjectIndexSha256: sha256(canonicalJson(objectIndex)),
      evaluatorKeyFingerprint: objectIndex.signature?.keyFingerprint,
      annotationSetSha256: sha256(canonicalJson(labels)),
    },
    candidate: predictions.candidate,
    hardware: predictions.hardware,
    strata: Object.fromEntries(Object.entries(perStratum).map(([name, metrics]) => [name, {
      items: metrics.items,
      samples: metrics.samples,
      activeSpeakerF1: metrics.activeSpeakerF1,
      visibleSpeakerCoverage: metrics.visibleSpeakerCoverage,
    }])),
    safety: {
      offscreenFalseAssignmentRate: all.offscreenUs === 0 ? 0 : Number((all.falseOffscreenAssignmentUs / all.offscreenUs).toFixed(6)),
      p95SwitchLatencyMs: p95LatencyUs === null ? null : Number((p95LatencyUs / 1_000).toFixed(3)),
      unresolvedSwitchRate: all.switchLatenciesUs.length === 0 ? 0 : Number((all.unresolvedSwitches / all.switchLatenciesUs.length).toFixed(6)),
    },
    resources: {
      p95DenseAnalysisRssBytes: percentile(rss, 0.95) ?? 0,
      sustainedSwapBytes: Math.max(0, ...swaps),
    },
    evaluation: {
      evaluatorVersion: "hve-active-speaker-evaluator-v1",
      generatedAt,
      itemsEvaluated: labelsByItem.size,
      turnsEvaluated: all.samples,
      evaluatedDurationUs: all.totalUs,
      predictionBundleSha256: sha256(canonicalJson(predictions)),
      labelBundleSha256: sha256(canonicalJson(labels)),
      failureSamples: itemFailures,
      overall: publicStratumMetrics(all),
    },
  };
  return report;
}
