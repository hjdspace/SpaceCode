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
    // 先清理上一次的连接资源，避免旧 stream 事件污染新状态
    _subscription?.cancel();
    _channel?.sink.close();
    _channel = null;

    state = const ConnectionInfo(state: ConnectionState.connecting);

    Uri parsed;
    try {
      parsed = Uri.parse(url);
    } catch (e) {
      state = ConnectionInfo(
        state: ConnectionState.error,
        errorMessage: '无效的 URL: $e',
      );
      return;
    }

    try {
      _channel = WebSocketChannel.connect(parsed);
      // 主动等待握手完成；连接失败（DNS/路由/拒绝/超时）会在此抛出
      // 否则错误会冒泡为 Unhandled Exception，状态卡在 connecting
      await _channel!.ready;
    } catch (e) {
      state = ConnectionInfo(
        state: ConnectionState.error,
        errorMessage: e.toString(),
      );
      _channel = null;
      return;
    }

    // 握手成功后注册监听；后续 stream 错误（断连等）仍走 onError
    _subscription = _channel!.stream.listen(
      (data) {
        try {
          final json = jsonDecode(data as String) as Map<String, dynamic>;
          final push = MobilePush.fromJson(json);

          if (push.type == PushType.connected) {
            state = ConnectionInfo(
              state: ConnectionState.connected,
              clientInfo: push.data?['deviceName'] as String?,
            );
          }

          _messageController.add(push);
        } catch (e) {
          // 业务层解析异常不应影响连接本身
          _messageController.addError(e);
        }
      },
      onError: (error) {
        state = ConnectionInfo(
          state: ConnectionState.error,
          errorMessage: error.toString(),
        );
      },
      onDone: () {
        // 仅在非 error 状态下回退到 disconnected，避免覆盖错误信息
        if (state.state != ConnectionState.error) {
          state = const ConnectionInfo(state: ConnectionState.disconnected);
        }
      },
      cancelOnError: true,
    );
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
