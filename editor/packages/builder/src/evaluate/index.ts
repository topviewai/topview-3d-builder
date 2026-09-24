export {
  evaluateFrame,
  createFrameSnapshot,
  prepareFrameSnapshot,
} from './evaluateFrame'
export type { FrameSnapshot, SceneContract } from './evaluateFrame'
export { sceneFromDocument } from './sceneFromDocument'
export type { SceneOverlays } from './sceneFromDocument'
export { FCurveSet } from './curves/FCurveSet'
export type { FCurve, FCurveHandle, FCurveKey } from './curves/FCurveSet'
export {
  bakeCameraMotionClip,
  bakeCameraMotionClip as bakeCameraMotion,
  bakeCameraMotionPoses,
  applyCameraPresetToNode,
} from './camera/bakeMotion'
export { defaultVideoExportEndFrame } from './camera/cameraMotionRange'
export type { BakeContext, BakeResult, BakePosesResult, CameraPoseSample } from './camera/bakeMotion'
export {
  evaluatePathMotion,
  evaluatePathMotionInto,
  pathArcLength,
  pathClipDurationFrames,
  pathControlCentroid,
  samplePathPoints,
  transformPathLocalPoint,
} from './path/samplePath'
export type { PathEval } from './path/samplePath'
export {
  getEditorial,
  getEditSequence,
  getClipDurationFrames,
  getEditSequenceDurationFrames,
  resolveEditSequenceFrame,
  validateEditorial,
} from './editSequence'
export type {
  ResolvedEditSequenceFrame,
  EditSequenceIssue,
  EditSequenceIssueCode,
  ValidateEditorialOptions,
} from './editSequence'
export {
  emptyEditorial,
  materializeEditorial,
  allocateSequenceId,
  allocateClipId,
  findEditClip,
  getActiveEditSequence,
  clipSequenceSpan,
  playbackIssues,
  createSequence,
  renameSequence,
  duplicateSequence,
  deleteSequence,
  activateSequence,
  clearSequenceClips,
  insertEditClip,
  updateEditClip,
  moveEditClip,
  duplicateEditClip,
  deleteEditClip,
  defaultInsertRange,
} from './editSequenceOps'
export type { EditOpError, EditOpResult, FoundEditClip, ClipSequenceSpan } from './editSequenceOps'
export type {
  EditorialData,
  EditSequence,
  EditSequenceClip,
} from '../contract/types'
export { formatTimecode, parseTimecode, framesToSeconds, secondsToFrame } from './timecode'
export { parseDirectorDocument, directorDocumentSchema, fcurvesCompactV1Schema } from '../contract/validate'
export { makeEmptyDraft } from '../contract/emptyDraft'
export type { EmptyDraftCamera } from '../contract/emptyDraft'
export { DEFAULT_SKY_COLOR } from '../contract/skyColor'
export {
  createInitialDraft,
  pickDefaultCharacter,
  seedDefaultCharacterInPlace,
} from './initialDraft'
export type { InitialDraftInput } from './initialDraft'
export { DEFAULT_CHARACTER, INITIAL_DRAFT_SEED } from '../data/defaultCharacter'
export type { DefaultCharacterPreset } from '../data/defaultCharacter'
export { CAMERA_PRESETS, CAMERA_MOTIONS } from '../data/cameraLibrary'
export type { CameraPreset, CameraMotionPreset } from '../data/cameraLibrary'
export {
  applyStudioIntent,
  applyStudioIntentInPlace,
  buildCharacterNode,
  buildPropNode,
  buildCameraNode,
  appendMotionClip,
  applyPoseInPlace,
  setCameraFovInPlace,
  setCameraDistanceInPlace,
  patchNodeTransformInPlace,
  uniqueNodeName,
  listStudioCameraPresets,
  clampCameraFov,
  dollyTowardLookAt,
  StudioIntentError,
} from './studioIntents'
export type {
  StudioIntent,
  StudioIntentResult,
  StudioIntentErrorCode,
  AddCharacterIntent,
  AddPropIntent,
  AddCameraIntent,
  AddMotionIntent,
  ApplyPoseIntent,
  SetFovIntent,
  SetDistanceIntent,
  PatchTransformIntent,
} from './studioIntents'
