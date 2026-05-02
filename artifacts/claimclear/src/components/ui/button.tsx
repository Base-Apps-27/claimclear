import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { useBreath } from "@/hooks/use-breath"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0" +
" hover-elevate active-elevate-2",
  {
    variants: {
      variant: {
        default:
           "bg-primary text-primary-foreground border border-primary-border",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm border-destructive-border",
        outline:
          " border [border-color:var(--button-outline)] shadow-xs active:shadow-none ",
        secondary:
          "border bg-secondary text-secondary-foreground border border-secondary-border ",
        ghost: "border border-transparent",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "min-h-9 px-4 py-2",
        sm: "min-h-8 rounded-md px-3 text-xs",
        lg: "min-h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  /**
   * Save-confirmation breath (Task #316). Pass any value that *changes*
   * after a successful routine save (a counter is the typical choice) and
   * the button will play a quiet ~250ms scale-down + success-tint
   * animation in place of a "Saved" toast, briefly disabling itself so it
   * can't be double-clicked. Honors `prefers-reduced-motion` (skips the
   * scale, only shows the tint). Compared by `Object.is` against the
   * previous render — undefined disables the affordance entirely.
   */
  breathTrigger?: unknown
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, asChild = false, breathTrigger, disabled, ...props },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button"
    const { breathing, trigger, className: breathClass } = useBreath()
    const lastTriggerRef = React.useRef<unknown>(breathTrigger)

    React.useEffect(() => {
      if (breathTrigger === undefined) return
      if (Object.is(breathTrigger, lastTriggerRef.current)) return
      lastTriggerRef.current = breathTrigger
      trigger()
    }, [breathTrigger, trigger])

    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }), breathClass)}
        ref={ref}
        disabled={disabled || breathing}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
