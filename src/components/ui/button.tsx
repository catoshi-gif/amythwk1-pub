import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-xl border text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brandAmethyst/30 disabled:pointer-events-none disabled:opacity-60 font-display",
  {
    variants: {
      variant: {
        primary:
          "border-[#6C46F3] bg-brandAmethyst text-white shadow-[0_16px_40px_-18px_rgba(84,31,243,0.58)] hover:-translate-y-0.5 hover:bg-[#4B18E8] hover:shadow-[0_22px_50px_-18px_rgba(84,31,243,0.66)]",
        secondary:
          "border-brandStroke bg-brandSurface text-brandCharcoal shadow-[0_12px_30px_-20px_rgba(84,31,243,0.24)] hover:border-brandLavender/55 hover:bg-brandSurfaceSoft",
        ghost:
          "border-transparent bg-transparent text-brandSoft hover:bg-brandSurfaceSoft hover:text-brandCharcoal",
      },
      size: {
        sm: "px-3 py-2 text-xs",
        md: "px-4 py-2.5",
        lg: "px-6 py-3",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, ...props },
  ref
) {
  return <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});

export { Button, buttonVariants };
