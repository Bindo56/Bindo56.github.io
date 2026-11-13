export declare class ProofError extends Error {
  status: number
  constructor(status: number, message: string)
}

export interface ProofService {
  state(): unknown
  control(command: unknown): unknown
  close(): void
}

export declare function createProofService(options?: {
  databasePath?: string
  now?: () => number
}): ProofService
