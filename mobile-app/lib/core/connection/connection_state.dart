enum ConnectionState { disconnected, connecting, connected, error }

class ConnectionInfo {
  final ConnectionState state;
  final String? errorMessage;
  final String? clientInfo;

  const ConnectionInfo({
    this.state = ConnectionState.disconnected,
    this.errorMessage,
    this.clientInfo,
  });

  ConnectionInfo copyWith({
    ConnectionState? state,
    String? errorMessage,
    String? clientInfo,
  }) => ConnectionInfo(
    state: state ?? this.state,
    errorMessage: errorMessage ?? this.errorMessage,
    clientInfo: clientInfo ?? this.clientInfo,
  );
}
