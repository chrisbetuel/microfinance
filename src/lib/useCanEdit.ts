import { useStore } from '../store/useStore'
import { canEditData } from './permissions'

export function useCanEdit(): boolean {
  const role = useStore((s) => s.currentUser?.role)
  return role ? canEditData(role) : false
}
