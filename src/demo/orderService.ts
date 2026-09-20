export async function sendOrderConfirmation(orderId: string, email: string): Promise<void> {
  await mailClient.send(email, orderId);
}
