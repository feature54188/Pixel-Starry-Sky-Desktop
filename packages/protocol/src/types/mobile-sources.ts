export type PhoneSource = { kind: 'self' } | { kind: 'platform'; groupId: string } | { kind: 'provider'; id: string }
export interface PhoneModelChoice {
  engine: import('./base').EngineId
  model: string
  source: PhoneSource
  name: string
  rate?: number
  billing?: string
}

export interface PhoneSources {
  platform: { id: string; name: string; rate: number; billing?: string; models: string[] }[] | null
  platformError: string | null
  providers: { id: string; name: string; models: string[] }[]
  canPickSource?: boolean
  composer?: boolean
  desktopPermissions?: boolean
}
