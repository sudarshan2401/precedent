export async function notifyShipmentDispatched(shipmentId: string, phone: string): Promise<void> {
  await smsClient.send(phone, `Your shipment ${shipmentId} has been dispatched.`);
}

export async function handleCarrierWebhook(event: CarrierEvent): Promise<void> {
  await notifyShipmentDispatched(event.shipmentId, event.customerPhone);
}
