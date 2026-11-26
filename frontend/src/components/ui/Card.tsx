import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-[var(--radius-card)] border border-border bg-surface shadow-sm", className)}
      {...rest}
    />
  );
}

export interface CardHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title: ReactNode;
  description?: ReactNode;
  /** Right-aligned slot for buttons or links. */
  action?: ReactNode;
}

export function CardHeader({ title, description, action, className, ...rest }: CardHeaderProps) {
  return (
    <div className={cn("flex items-start justify-between gap-4 p-5 pb-0", className)} {...rest}>
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-fg">{title}</h2>
        {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5", className)} {...rest} />;
}

export function CardFooter({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center gap-2 border-t border-border px-5 py-3", className)} {...rest} />;
}
