import 'dart:convert';
import 'protocol.dart';

class ProtocolParser {
  static MobilePush parse(String raw) {
    final json = jsonDecode(raw) as Map<String, dynamic>;
    return MobilePush.fromJson(json);
  }

  static String serialize(MobileRequest request) {
    return jsonEncode(request.toJson());
  }
}
