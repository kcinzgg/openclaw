# Feishu Native Audio Message Configuration

This document describes how to configure OpenClaw to send audio/voice messages using Feishu's native audio message UI.

## Configuration Option

### `useNativeAudioMessage`

**Type**: `boolean`  
**Default**: `false`  
**Scope**: Top-level config, account-level config

When enabled, audio files (`.opus`, `.ogg`) are sent as `msg_type="audio"` instead of `msg_type="media"`, displaying with Feishu's native voice message UI (waveform, play button) rather than a generic media player.

## Usage

### Enable for All Accounts

Add to your OpenClaw configuration file:

```yaml
channels:
  feishu:
    useNativeAudioMessage: true
```

### Enable for Specific Account

```yaml
channels:
  feishu:
    accounts:
      main:
        useNativeAudioMessage: true
      secondary:
        useNativeAudioMessage: false
```

## UI Differences

### With `useNativeAudioMessage: true` (msg_type="audio")

- ✅ Displays as native voice message UI in Feishu
- ✅ Shows waveform visualization
- ✅ Looks identical to user-sent voice messages
- ✅ Supports optional duration parameter

### With `useNativeAudioMessage: false` (msg_type="media", default)

- Shows generic media player UI
- Displays as a media attachment/file
- Works for both audio and video files

## Affected Features

This setting applies to:

- **TTS (Text-to-Speech) responses**: When the AI generates voice replies
- **Any opus/ogg audio files**: Sent via `sendMediaFeishu` or channel outbound adapter

## Example: Testing with TTS

1. Enable the configuration:

   ```yaml
   channels:
     feishu:
       useNativeAudioMessage: true
   ```

2. Configure TTS in your agent or global settings

3. Ask the AI to respond with voice:

   ```
   请用语音回复我
   ```

4. The response will display as a native voice message in Feishu

## Technical Details

- **Affected message types**: Only `.opus` and `.ogg` files
- **API field**: Uses `msg_type="audio"` with `file_key` and optional `duration` (milliseconds)
- **Backward compatible**: Default behavior unchanged when option is not set
- **Non-audio files**: `.mp4`, `.mp3`, and other formats continue using `msg_type="media"` or `msg_type="file"`

## See Also

- [PR #28184](https://github.com/openclaw/openclaw/pull/28184) - Implementation details
- `extensions/feishu/src/media.ts` - `sendAudioFeishu` function
- `extensions/feishu/src/config-schema.ts` - Configuration schema
