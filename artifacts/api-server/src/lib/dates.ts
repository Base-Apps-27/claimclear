export function daysRemaining(serviceDate: string | null): number | null {
  if (!serviceDate) return null;
  const deadline = new Date(serviceDate);
  deadline.setDate(deadline.getDate() + 30);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  deadline.setHours(0, 0, 0, 0);
  return Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}
