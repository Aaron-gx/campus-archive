import type { RemixiconComponentType } from "@remixicon/react"
import type React from "react"

declare module "@remixicon/react" {
  export type IconType = RemixiconComponentType | React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>
}
