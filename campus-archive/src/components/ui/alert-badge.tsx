import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { IconType } from "@remixicon/react"

const alertBadgeVariants = cva(
  "inline-flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-tremor-label font-medium text-white",
  {
    variants: {
      variant: {
        error: "bg-red-500",
        success: "bg-emerald-500",
        info: "bg-blue-500",
      },
    },
    defaultVariants: {
      variant: "info",
    },
  },
)

export interface AlertBadgeAction {
  label: string
  href?: string
  onClick?: (e: React.MouseEvent) => void
  icon?: IconType
}

export interface AlertBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof alertBadgeVariants> {
  icon?: IconType
  label: string
  action?: AlertBadgeAction
}

export function AlertBadge({
  className,
  variant,
  icon: Icon,
  label,
  action,
  ...props
}: AlertBadgeProps) {
  return (
    <span className={cn(alertBadgeVariants({ variant }), className)} {...props}>
      <span className="inline-flex items-center gap-1.5">
        {Icon && <Icon className="size-4" aria-hidden={true} />}
        {label}
      </span>
      {action && (
        <>
          <span
            className={cn(
              "h-5 w-px",
              variant === "error" && "bg-red-400",
              variant === "success" && "bg-emerald-400",
              variant === "info" && "bg-blue-400",
            )}
          />
          {action.href ? (
            <a
              href={action.href}
              onClick={action.onClick}
              className="inline-flex items-center gap-1.5 hover:opacity-90 transition-opacity"
            >
              {action.label}
              {action.icon && (
                <action.icon className="size-4" aria-hidden={true} />
              )}
            </a>
          ) : (
            <button
              type="button"
              onClick={action.onClick}
              className="inline-flex items-center gap-1.5 hover:opacity-90 transition-opacity bg-transparent border-none p-0 text-inherit font-inherit cursor-pointer"
            >
              {action.label}
              {action.icon && (
                <action.icon className="size-4" aria-hidden={true} />
              )}
            </button>
          )}
        </>
      )}
    </span>
  )
}
