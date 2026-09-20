export async function sendOrderConfirmation(orderId: string, email: string): Promise<void> {
  const alreadySent = await confirmationLog.has(orderId);
  if (alreadySent) return;

  await mailClient.send(email, orderId);
  await confirmationLog.markSent(orderId);
}
