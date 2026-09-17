// SDK 1.30.0's concrete HTTP transport works with Server at runtime, but its
// optional callback declarations differ under exactOptionalPropertyTypes.
// Keep that peer-specific connection boundary here, not in every application.
export async function connectCapabilityMcpHttpTransport(server,transport){
 await server.connect(transport);
}
