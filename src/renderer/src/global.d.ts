import type { ManulApi } from '../../preload/index'

declare global {
  interface Window { manul: ManulApi }
}
