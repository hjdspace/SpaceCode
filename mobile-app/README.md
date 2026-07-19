# spacecode_mobile

A new Flutter project.

## Getting Started

This project is a starting point for a Flutter application.

A few resources to get you started if this is your first Flutter project:

- [Learn Flutter](https://docs.flutter.dev/get-started/learn-flutter)
- [Write your first Flutter app](https://docs.flutter.dev/get-started/codelab)
- [Flutter learning resources](https://docs.flutter.dev/reference/learning-resources)

For help getting started with Flutter development, view the
[online documentation](https://docs.flutter.dev/), which offers tutorials,
samples, guidance on mobile development, and a full API reference.

## Github browser authentication

Register a Github OAuth App with Device Flow enabled, then pass its client ID at build/run time:

```bash
flutter run --dart-define=SPACE_CODE_GITHUB_CLIENT_ID=your_client_id
```

The Settings page opens Github in the system browser, displays the device code, and polls until the user authorizes the app. The client ID is public; the resulting access token is stored locally on the device.
