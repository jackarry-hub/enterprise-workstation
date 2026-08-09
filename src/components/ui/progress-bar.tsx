import { Progress } from "@/components/ui/progress";

type ProgressBarProps = React.ComponentProps<typeof Progress>;

export function ProgressBar({ value = 0, ...props }: ProgressBarProps) {
  const normalizedValue = Math.min(100, Math.max(0, value ?? 0));

  return <Progress value={normalizedValue} {...props} />;
}
