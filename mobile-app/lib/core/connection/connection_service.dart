import 'dart:async';
import 'dart:convert';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import '../protocol/protocol.dart';
import 'connection_state.dart';

final connectionProvider = StateNotifierProvider<ConnectionNotifier, ConnectionInfo>((ref) {
  return ConnectionNotifier();
});

class ConnectionNotifier extends StateNotifier<ConnectionInfo> {
  WebSocketChannel? _channel;
  StreamSubscription? _subscription;
  final _messageController = StreamController<MobilePush>.broadcast();

  Stream<MobilePush> get messages => _messageController.stream;

  ConnectionNotifier() : super(const ConnectionInfo());

  Future<void> connect(String url) async {
    state = const ConnectionInfo(state: ConnectionState.connecting);

    try {
      _channel = WebSocketChannel.connect(Uri.parse(url));

      _subscription = _channel!.stream.listen(
        (data) {
          final json = jsonDecode(data as String) as Map<String, dynamic>;
          final push = MobilePush.fromJson(json);

          if (push.type == PushType.connected) {
            state = ConnectionInfo(
              state: ConnectionState.connected,
              clientInfo: push.data?['deviceName'] as String?,
            );
          }

          _messageController.add(push);
        },
        onError: (error) {
          state = ConnectionInfo(
            state: ConnectionState.error,
            errorMessage: error.toString(),
          );
        },
        onDone: () {
          state = const ConnectionInfo(state: ConnectionState.disconnected);
        },
      );
    } catch (e) {
      state = ConnectionInfo(
        state: ConnectionState.error,
        errorMessage: e.toString(),
      );
    }
  }

  void send(MobileRequest request) {
    if (_channel != null) {
      _channel!.sink.add(jsonEncode(request.toJson()));
    }
  }

  void disconnect() {
    _subscription?.cancel();
    _channel?.sink.close();
    _channel = null;
    state = const ConnectionInfo(state: ConnectionState.disconnected);
  }

  @override
  void dispose() {
    disconnect();
    _messageController.close();
    super.dispose();
  }
}
