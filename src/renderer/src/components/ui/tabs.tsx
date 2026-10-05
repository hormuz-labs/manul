import * as T from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

export const Tabs = T.Root
export const TabsContent = T.Content
export function TabsList({ className, ...p }: T.TabsListProps) {
  return <T.List className={cn('mb-4 inline-flex rounded-lg border border-line bg-bg p-0.5', className)} {...p} />
}
export function TabsTrigger({ className, ...p }: T.TabsTriggerProps) {
  return <T.Trigger className={cn('inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-xs font-medium text-dim transition-colors hover:text-fg data-[state=active]:bg-raised data-[state=active]:text-fg data-[state=active]:shadow-sm', className)} {...p} />
}
