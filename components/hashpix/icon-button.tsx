import type { ComponentProps, ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AsyncButton } from "./async-button";

type IconButtonProps = Omit<ComponentProps<typeof AsyncButton>, "children" | "size"> & {
  children: ReactNode;
  label: string;
  tooltip?: string;
};

export function IconButton({ label, tooltip = label, children, ...props }: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={(
          <AsyncButton {...props} size="icon" aria-label={label}>
            {children}
          </AsyncButton>
        )}
      />
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
