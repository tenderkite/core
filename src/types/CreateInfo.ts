import { Router } from "./Router"

export type StrictCreateInfo = [string, any]
export type CreateInfo = string | StrictCreateInfo
export type StrictServiceCreateInfo = [Router, any]
export type ServiceCreateInfo = Router | [Router, any]
