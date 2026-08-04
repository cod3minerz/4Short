import { canonicalJson, sha256 } from "./corpus-index.mjs";

/**
 * Pure evaluator for automatic HVE-G6 layout direction.
 *
 * Candidate region IDs are deliberately meaningless outside an evaluator
 * bundle. This scorer sees only evaluator-owned mappings to semantic label
 * IDs, so a detector cannot win by renaming regions or by claiming that a
 * generic central crop is a screen/gameplay composition.
 */

const HASH = /^[a-f0-9]{64}$/i;
const STRATA = new Set(["screen_presenter", "gameplay_facecam", "panel_three_four"]);
const ROLES = new Set(["screen", "gameplay", "face", "facecam"]);

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isHash = (value) => typeof value === "string" && HASH.test(value);
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
const ratio = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const equalRange = (left, right) => left?.startUs === right?.startUs && left?.endUs === right?.endUs;

function percentile(values, quantile) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1))] ?? 0;
}

function stratumFor(contentType) {
  if (contentType === "screen_speaker") return "screen_presenter";
  if (contentType === "gameplay_facecam") return "gameplay_facecam";
  if (contentType === "panel" || contentType === "remote_grid") return "panel_three_four";
  return null;
}

function expectedRoles(stratum) {
  if (stratum === "screen_presenter") return ["screen", "face"];
  if (stratum === "gameplay_facecam") return ["gameplay", "facecam"];
  return ["face"];
}

function assertBundleBinding(bundle, kind, manifest, objectIndex) {
  if (!isRecord(bundle) || bundle.schemaVersion !== 1 || bundle.kind !== kind || !Array.isArray(bundle.items)) {
    throw new Error(`${kind} bundle is malformed`);
  }
  if (bundle.corpusVersion !== manifest.corpusVersion) throw new Error(`${kind} corpusVersion does not match manifest`);
  if (bundle.manifestSha256 !== objectIndex.manifestSha256) throw new Error(`${kind} does not bind signed manifest`);
  if (bundle.objectIndexSha256 !== sha256(canonicalJson(objectIndex))) throw new Error(`${kind} does not bind signed object index`);
  if (bundle.evaluatorKeyFingerprint !== objectIndex.signature?.keyFingerprint) throw new Error(`${kind} evaluator key mismatch`);
}

function labelsFor(manifest, objectIndex, labels) {
  assertBundleBinding(labels, "hve-layout-director-labels-v1", manifest, objectIndex);
  const manifestItems = new Map(manifest.items.map((item) => [item.itemId, item]));
  const output = new Map();
  for (const entry of labels.items) {
    if (!isRecord(entry) || typeof entry.itemId !== "string" || !isHash(entry.annotationSha256) || !isRecord(entry.annotation)) {
      throw new Error("layout label entry is malformed");
    }
    if (output.has(entry.itemId)) throw new Error(`layout labels duplicate ${entry.itemId}`);
    const source = manifestItems.get(entry.itemId);
    if (!source) throw new Error(`layout labels refer to unknown ${entry.itemId}`);
    if (entry.annotationSha256 !== source.annotationSha256 || entry.annotationSha256 !== objectIndex.objects?.[source.annotationKey]?.sha256) {
      throw new Error(`layout labels annotation hash does not bind ${entry.itemId}`);
    }
    if (!Array.isArray(entry.annotation.ranges)) throw new Error(`layout labels ${entry.itemId} has no ranges`);
    const ranges = [];
    for (const range of entry.annotation.ranges) {
      if (!isRecord(range) || typeof range.rangeId !== "string" || !range.rangeId
        || !Number.isSafeInteger(range.startUs) || !positiveInteger(range.endUs) || range.startUs < 0 || range.endUs <= range.startUs
        || range.endUs > source.durationUs || typeof range.contentType !== "string"
        || !Array.isArray(range.acceptableLayouts) || !Array.isArray(range.forbiddenLayouts) || !isRecord(range.constraints)) {
        throw new Error(`layout labels ${entry.itemId} contains a malformed range`);
      }
      const stratum = stratumFor(range.contentType);
      if (!stratum) continue;
      const roles = range.constraints.regionRoles;
      const mustKeep = range.constraints.mustKeepRegionIds;
      if (!isRecord(roles) || Object.entries(roles).some(([id, role]) => !id || typeof role !== "string" || !ROLES.has(role))) {
        throw new Error(`layout labels ${entry.itemId}/${range.rangeId} require semantic regionRoles`);
      }
      if (!Array.isArray(mustKeep) || mustKeep.some((id) => typeof id !== "string" || !id)) {
        throw new Error(`layout labels ${entry.itemId}/${range.rangeId} mustKeepRegionIds is malformed`);
      }
      if (expectedRoles(stratum).some((role) => !Object.values(roles).includes(role))) {
        throw new Error(`layout labels ${entry.itemId}/${range.rangeId} lack required ${stratum} semantic roles`);
      }
      ranges.push({
        stratum,
        rangeId: range.rangeId,
        range: { startUs: range.startUs, endUs: range.endUs },
        acceptable: new Set(range.acceptableLayouts),
        forbidden: new Set(range.forbiddenLayouts),
        roles,
        mustKeep: new Set(mustKeep),
      });
    }
    output.set(entry.itemId, { source, ranges });
  }
  if (!output.size) throw new Error("layout labels contain no HVE-G6 ranges");
  return output;
}

function predictionsFor(manifest, objectIndex, labels, predictions) {
  assertBundleBinding(predictions, "hve-layout-director-predictions-v1", manifest, objectIndex);
  if (!isRecord(predictions.candidate) || !isRecord(predictions.hardware)) throw new Error("layout predictions lack candidate/hardware provenance");
  for (const field of ["regionDetector", "regionModelVersion", "faceDetector", "faceModelVersion", "directorVersion"]) {
    if (typeof predictions.candidate[field] !== "string" || predictions.candidate[field].length < 2) throw new Error(`candidate.${field} is invalid`);
  }
  for (const field of ["regionModelSha256", "faceModelSha256", "directorCodeSha256"]) {
    if (!isHash(predictions.candidate[field])) throw new Error(`candidate.${field} is invalid`);
  }
  if (predictions.hardware.profile !== "timeweb-cpu8-12gb" || !positiveInteger(predictions.hardware.cpuCount) || !positiveInteger(predictions.hardware.memoryBytes)) {
    throw new Error("layout predictions must identify Timeweb CPU8/12GB");
  }
  const output = new Map();
  for (const entry of predictions.items) {
    if (!isRecord(entry) || typeof entry.itemId !== "string" || !isHash(entry.sourceHash) || !Array.isArray(entry.decisions)
      || !isRecord(entry.evaluatorMappings) || !isRecord(entry.evaluatorMappings.regions) || !isRecord(entry.measurement)) {
      throw new Error("layout prediction entry is malformed");
    }
    if (output.has(entry.itemId)) throw new Error(`layout predictions duplicate ${entry.itemId}`);
    const label = labels.get(entry.itemId);
    if (!label) throw new Error(`layout predictions contain unlabelled ${entry.itemId}`);
    if (entry.sourceHash.toLowerCase() !== label.source.sha256.toLowerCase()) throw new Error(`layout prediction ${entry.itemId} source hash mismatch`);
    for (const [candidateRegion, goldRegion] of Object.entries(entry.evaluatorMappings.regions)) {
      if (!candidateRegion || typeof goldRegion !== "string" || !goldRegion) throw new Error(`layout prediction ${entry.itemId} region mapping is malformed`);
    }
    for (const field of ["peakRssBytes", "sustainedSwapBytes", "wallSeconds", "mediaSeconds", "coldStartSeconds"]) {
      if (typeof entry.measurement[field] !== "number" || !Number.isFinite(entry.measurement[field]) || entry.measurement[field] < 0) {
        throw new Error(`layout prediction ${entry.itemId} measurement.${field} is invalid`);
      }
    }
    const decisions = new Map();
    for (const decision of entry.decisions) {
      if (!isRecord(decision) || typeof decision.rangeId !== "string" || !decision.rangeId || !isRecord(decision.range)
        || !Number.isSafeInteger(decision.range.startUs) || !positiveInteger(decision.range.endUs) || decision.range.endUs <= decision.range.startUs
        || typeof decision.template !== "string" || !decision.template || !Array.isArray(decision.regions)
        || typeof decision.transitionLatencyMs !== "number" || !Number.isFinite(decision.transitionLatencyMs) || decision.transitionLatencyMs < 0) {
        throw new Error(`layout prediction ${entry.itemId} decision is malformed`);
      }
      if (decisions.has(decision.rangeId)) throw new Error(`layout prediction ${entry.itemId} duplicates ${decision.rangeId}`);
      const regions = new Map();
      for (const region of decision.regions) {
        if (!isRecord(region) || typeof region.regionId !== "string" || !region.regionId || !ratio(region.visibleAreaRatio) || regions.has(region.regionId)) {
          throw new Error(`layout prediction ${entry.itemId}/${decision.rangeId} region evidence is malformed`);
        }
        regions.set(region.regionId, region.visibleAreaRatio);
      }
      decisions.set(decision.rangeId, { ...decision, regions });
    }
    output.set(entry.itemId, { ...entry, decisions });
  }
  for (const itemId of labels.keys()) if (!output.has(itemId)) throw new Error(`layout predictions omit labelled ${itemId}`);
  return output;
}

function counters() {
  return { items: new Set(), samples: 0, expectedScreen: 0, foundScreen: 0, expectedFace: 0, foundFace: 0, expectedPanel: 0, foundPanel: 0, layouts: 0, forbidden: 0, required: 0, missingRequired: 0, cropLoss: [], transitions: [] };
}

function metrics(counter, stratum) {
  const ratioOf = (found, expected) => expected ? Number((found / expected).toFixed(6)) : 0;
  const result = { samples: counter.samples, layoutAccuracy: ratioOf(counter.layouts, counter.samples) };
  if (stratum === "panel_three_four") return { ...result, panelTrackRecall: ratioOf(counter.foundPanel, counter.expectedPanel) };
  return { ...result, screenRegionRecall: ratioOf(counter.foundScreen, counter.expectedScreen), faceRegionRecall: ratioOf(counter.foundFace, counter.expectedFace) };
}

/**
 * Computes exact, per-stratum G6 metrics from signed input bundles. It does
 * not set thresholds and cannot unlock a product feature by itself.
 */
export function evaluateLayoutDirector({ manifest, objectIndex, labels, predictions, generatedAt = new Date().toISOString() }) {
  if (!isRecord(manifest) || !Array.isArray(manifest.items) || !isRecord(objectIndex) || !isRecord(objectIndex.objects)) {
    throw new Error("manifest and signed object index are required");
  }
  const labelItems = labelsFor(manifest, objectIndex, labels);
  const predictionItems = predictionsFor(manifest, objectIndex, labelItems, predictions);
  const perStratum = new Map([...STRATA].map((stratum) => [stratum, counters()]));
  const all = counters();
  const rss = [];
  const swaps = [];
  const failures = [];

  const add = (counter, field, present = true) => { counter[field] += 1; if (present) counter[field.replace("expected", "found")] += 1; };
  for (const [itemId, label] of labelItems) {
    const prediction = predictionItems.get(itemId);
    if (!prediction) throw new Error(`layout prediction missing ${itemId}`);
    rss.push(prediction.measurement.peakRssBytes);
    swaps.push(prediction.measurement.sustainedSwapBytes);
    for (const target of label.ranges) {
      const stratum = perStratum.get(target.stratum);
      if (!stratum) throw new Error(`unsupported stratum ${target.stratum}`);
      const decision = prediction.decisions.get(target.rangeId);
      if (!decision || !equalRange(decision.range, target.range)) throw new Error(`layout prediction ${itemId}/${target.rangeId} does not bind the labelled range`);
      const actual = new Map([...decision.regions].map(([id, visible]) => [prediction.evaluatorMappings.regions[id] ?? `__unmapped:${id}`, visible]));
      const increment = (field, present) => { add(stratum, field, present); add(all, field, present); };
      for (const role of expectedRoles(target.stratum)) {
        for (const [goldId] of Object.entries(target.roles).filter(([, candidateRole]) => candidateRole === role)) {
          const visible = actual.get(goldId);
          const present = visible !== undefined && visible >= 0.98;
          if (role === "screen" || role === "gameplay") increment("expectedScreen", present);
          else if (target.stratum === "panel_three_four") increment("expectedPanel", present);
          else increment("expectedFace", present);
        }
      }
      for (const goldId of target.mustKeep) {
        const visible = actual.get(goldId);
        for (const counter of [stratum, all]) {
          counter.required += 1;
          if (visible === undefined) { counter.missingRequired += 1; counter.cropLoss.push(1); }
          else counter.cropLoss.push(1 - visible);
        }
      }
      for (const counter of [stratum, all]) {
        counter.items.add(itemId); counter.samples += 1; counter.transitions.push(decision.transitionLatencyMs);
        if (target.acceptable.has(decision.template)) counter.layouts += 1;
        if (target.forbidden.has(decision.template)) counter.forbidden += 1;
      }
      if (!target.acceptable.has(decision.template) || target.forbidden.has(decision.template)) {
        failures.push({ itemId, rangeId: target.rangeId, stratum: target.stratum, template: decision.template, reason: target.forbidden.has(decision.template) ? "forbidden_layout" : "unacceptable_layout" });
      }
    }
  }
  const aggregateCropLoss = all.cropLoss.length ? all.cropLoss.reduce((sum, value) => sum + value, 0) / all.cropLoss.length : 1;
  return {
    schemaVersion: 1, kind: "hve-layout-director-benchmark-v1", status: "pass", generatedAt,
    corpus: { version: manifest.corpusVersion, manifestSha256: objectIndex.manifestSha256, signedObjectIndexSha256: sha256(canonicalJson(objectIndex)), evaluatorKeyFingerprint: objectIndex.signature?.keyFingerprint, annotationSetSha256: sha256(canonicalJson(labels)) },
    candidate: predictions.candidate, hardware: predictions.hardware,
    strata: Object.fromEntries([...perStratum.entries()].map(([name, counter]) => [name, { items: counter.items.size, ...metrics(counter, name) }])),
    safety: { forbiddenLayoutRate: all.samples ? Number((all.forbidden / all.samples).toFixed(6)) : 1, importantScreenCropLossRate: Number(aggregateCropLoss.toFixed(6)), p95LayoutTransitionLatencyMs: percentile(all.transitions, 0.95) },
    resources: { p95DenseAnalysisRssBytes: percentile(rss, 0.95), sustainedSwapBytes: Math.max(0, ...swaps) },
    evaluation: { evaluatorVersion: "hve-layout-director-evaluator-v1", generatedAt, itemsEvaluated: labelItems.size, rangesEvaluated: all.samples, predictionBundleSha256: sha256(canonicalJson(predictions)), labelBundleSha256: sha256(canonicalJson(labels)), requiredRegionRecall: all.required ? Number(((all.required - all.missingRequired) / all.required).toFixed(6)) : 0, failureSamples: failures },
  };
}
