import { AlertBadge } from "@/components/ui/alert-badge"
import {
  RiArrowRightUpLine,
  RiNotificationFill,
  RiWifiLine,
} from "@remixicon/react"

export function AlertBadgeDemo() {
  return (
    <div className="flex flex-wrap justify-center gap-4">
      <AlertBadge 
        variant="error"
        label="Major incident"
        action={{
          label: "Updates",
          href: "#",
          icon: RiArrowRightUpLine
        }}
      />
      <AlertBadge 
        variant="success"
        icon={RiWifiLine}
        label="Connected"
        action={{
          label: "Edit",
          href: "#"
        }}
      />
      <AlertBadge 
        variant="info"
        icon={RiNotificationFill}
        label="1 Notification"
        action={{
          label: "Read",
          href: "#",
          icon: RiArrowRightUpLine
        }}
      />
    </div>
  )
}
