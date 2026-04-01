import { Badge } from "@/components/ui/badge";

type StatusBadgeProps = {
  status: string;
  className?: string;
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  let colorClass = "bg-gray-100 text-gray-800 border-gray-200";

  switch (status) {
    case "New":
      colorClass = "bg-blue-100 text-blue-800 border-blue-200";
      break;
    case "Needs Evidence":
      colorClass = "bg-amber-100 text-amber-800 border-amber-200";
      break;
    case "Generating Email":
      colorClass = "bg-indigo-100 text-indigo-800 border-indigo-200";
      break;
    case "Ready to Review":
      colorClass = "bg-cyan-100 text-cyan-800 border-cyan-200";
      break;
    case "Awaiting Response":
      colorClass = "bg-violet-100 text-violet-800 border-violet-200";
      break;
    case "On Hold":
      colorClass = "bg-purple-100 text-purple-800 border-purple-200";
      break;
    case "Resolved":
      colorClass = "bg-green-100 text-green-800 border-green-200";
      break;
    case "Denied":
      colorClass = "bg-red-100 text-red-800 border-red-200";
      break;
    // Outcomes
    case "Pending":
      colorClass = "bg-gray-100 text-gray-800 border-gray-200";
      break;
    case "Approved":
      colorClass = "bg-green-100 text-green-800 border-green-200";
      break;
    case "Partially Approved":
      colorClass = "bg-lime-100 text-lime-800 border-lime-200";
      break;
  }

  return (
    <Badge variant="outline" className={`${colorClass} ${className} font-medium tracking-tight shadow-none`}>
      {status}
    </Badge>
  );
}
