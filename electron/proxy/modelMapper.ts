import { ModelMappingConfig } from './types'

const ONE_M_MARKER = '[1M]'

export function stripOneMSuffix(model: string): string {
  const trimmed = model.trimEnd()
  if (trimmed.endsWith(ONE_M_MARKER)) {
    return trimmed.slice(0, -ONE_M_MARKER.length).trim()
  }
  if (trimmed.toLowerCase().endsWith(ONE_M_MARKER.toLowerCase())) {
    return trimmed.slice(0, -ONE_M_MARKER.length).trim()
  }
  return model
}

export function mapModel(model: string, mapping?: ModelMappingConfig): string {
  if (!mapping) return model

  const stripped = stripOneMSuffix(model)
  const lower = stripped.toLowerCase()

  if (lower.includes('haiku') && mapping.haikuModel) {
    return mapping.haikuModel
  }
  if (lower.includes('opus') && mapping.opusModel) {
    return mapping.opusModel
  }
  if (lower.includes('sonnet') && mapping.sonnetModel) {
    return mapping.sonnetModel
  }
  if (mapping.defaultModel) {
    return mapping.defaultModel
  }

  return stripped
}

export function applyModelMapping(
  body: Record<string, any>,
  mapping?: ModelMappingConfig
): { originalModel: string; mappedModel: string } {
  const originalModel = body.model || ''
  const mapped = mapModel(originalModel, mapping)
  body.model = mapped
  return { originalModel, mappedModel: mapped }
}
