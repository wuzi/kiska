import type { ComponentProps } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

// shadcn/ui button primitive, styled by the scoped board theme.
const buttonVariants = cva("", {
  variants: {
    variant: {
      default: "pb-primary",
      outline: "pb-neutral",
      destructive: "pb-danger",
      ghost: "pb-icon",
      link: "pb-link",
    },
  },
  defaultVariants: { variant: "default" },
});
type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };
export function Button({ asChild, variant, className, ...props }: ButtonProps) {
  const Component = asChild ? Slot : "button";
  return (
    <Component
      data-slot="button"
      data-variant={variant ?? "default"}
      className={buttonVariants({ variant, className })}
      {...props}
    />
  );
}
