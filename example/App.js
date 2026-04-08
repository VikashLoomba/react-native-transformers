import { StatusBar } from 'expo-status-bar';
import { fetch as expoFetch } from 'expo/fetch';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  AutoProcessor,
  env,
  GraniteSpeechForConditionalGeneration,
  pipeline,
  TextStreamer,
} from '@huggingface/transformers';
import { decodeAudioData } from 'react-native-audio-api';
import {
  getSupportedExecutionProviderNames,
  normalizeTransformersOptions,
} from '@automatalabs/react-native-transformers';

const SPEECH_MODEL_ID = 'onnx-community/granite-4.0-1b-speech-ONNX';
const CHAT_MODEL_ID = 'onnx-community/LFM2.5-350M-ONNX';
const SPEECH_AUDIO_URL =
  'https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/mlk.wav';
const REQUESTED_DEVICE = 'coreml';
const APP_FALLBACK_DEVICE_ORDER = Object.freeze(['coreml', 'xnnpack', 'cpu']);
const FALLBACK_VISIBILITY_NOTE =
  'Successful ONNX Runtime sessions do not expose exact per-node execution-provider fallback in the JavaScript API. This screen shows the requested execution-provider order and any app-level retries only.';
const SPEECH_MESSAGES = Object.freeze([
  {
    role: 'user',
    content: '<|audio|>can you transcribe the speech into a written format?',
  },
]);
const SPEECH_MODEL_DTYPE = Object.freeze({
  embed_tokens: 'q4',
  audio_encoder: 'q4',
  decoder_model_merged: 'q4',
});
const SPEECH_GENERATION_OPTIONS = Object.freeze({
  max_new_tokens: 256,
});
const CHAT_MESSAGES = Object.freeze([
  {
    role: 'system',
    content: 'You are a helpful assistant for a mobile AI demo. Reply with one short sentence.',
  },
  {
    role: 'user',
    content: 'Explain one benefit of running AI directly on a phone.',
  },
]);
const CHAT_GENERATION_OPTIONS = Object.freeze({
  max_new_tokens: 64,
  do_sample: false,
  repetition_penalty: 1.05,
});

const TESTS = Object.freeze([
  {
    id: 'speech-text-generation',
    title: 'Speech text generation',
    model: SPEECH_MODEL_ID,
    description:
      'Loads the Granite Speech ONNX model, fetches the model-card audio sample, and generates a transcript.',
  },
  {
    id: 'chat-text-generation',
    title: 'Chat text generation',
    model: CHAT_MODEL_ID,
    description:
      'Loads the LFM2.5 ONNX chat model and generates a short assistant reply from chat messages.',
  },
]);

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.fetch = expoFetch;
env.useBrowserCache = false;
env.useFS = false;
env.useFSCache = false;
env.useWasmCache = false;

function getErrorMessage(error) {
  return String(error?.stack ?? error?.message ?? error ?? 'Unknown error');
}

function getCompactErrorMessage(error) {
  return getErrorMessage(error).split('\n')[0] ?? 'Unknown error';
}

function getExecutionProviderName(provider) {
  if (typeof provider === 'string') {
    return provider;
  }

  if (provider && typeof provider === 'object' && typeof provider.name === 'string') {
    return provider.name;
  }

  return String(provider);
}

function formatChain(values, emptyText = 'Not started') {
  if (!Array.isArray(values) || values.length === 0) {
    return emptyText;
  }

  return values.map((value) => getExecutionProviderName(value)).join(' → ');
}

function truncateText(value, maxLength = 160) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.length > maxLength ? `${value.slice(0, maxLength - 1).trimEnd()}…` : value;
}

function cleanGeneratedText(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .replace(/\s+([.,!?;:])/g, '$1')
    .replace(/([A-Za-z])\.\s+([A-Za-z])/g, '$1.$2')
    .replace(/\s+/g, ' ')
    .trim();
}

function getExecutionProviderChainForDevice(device) {
  const normalizedOptions = normalizeTransformersOptions({ device });
  return Array.isArray(normalizedOptions?.session_options?.executionProviders)
    ? normalizedOptions.session_options.executionProviders.map((provider) =>
        getExecutionProviderName(provider),
      )
    : [];
}

function getAppFallbackDevices(supportedBackends) {
  const supported = new Set(supportedBackends ?? []);
  const candidates = [
    REQUESTED_DEVICE,
    ...APP_FALLBACK_DEVICE_ORDER.filter((device) => device !== REQUESTED_DEVICE),
  ];

  return Array.from(new Set(candidates)).filter(
    (device, index) => index === 0 || supported.size === 0 || supported.has(device),
  );
}

function createInitialChecks({ requestedExecutionProviders, appFallbackDevices }) {
  return TESTS.map((test) => ({
    ...test,
    status: 'Waiting',
    progress: 'Not started',
    summary: null,
    details: null,
    error: null,
    requestedDevice: REQUESTED_DEVICE,
    requestedExecutionProviders,
    appFallbackDevices,
    attemptedDevices: [],
    resolvedDevice: null,
    resolvedExecutionProviders: null,
    appFallbackUsed: null,
    fallbackTarget: null,
    fallbackReason: null,
  }));
}

function formatProgress(event) {
  if (!event || typeof event !== 'object') {
    return 'Waiting for model download to begin.';
  }

  const segments = [];

  if (event.status) {
    segments.push(String(event.status));
  }

  if (event.file) {
    segments.push(String(event.file));
  }

  if (typeof event.progress === 'number') {
    segments.push(`${Math.round(event.progress)}%`);
  }

  if (typeof event.loaded === 'number' && typeof event.total === 'number' && event.total > 0) {
    segments.push(`${event.loaded}/${event.total}`);
  }

  return segments.join(' | ') || 'Downloading model assets.';
}

function mixAudioBufferToMono(audioBuffer) {
  if (audioBuffer.numberOfChannels === 1) {
    return new Float32Array(audioBuffer.getChannelData(0));
  }

  const mono = new Float32Array(audioBuffer.length);
  const channels = Array.from({ length: audioBuffer.numberOfChannels }, (_, channelIndex) =>
    audioBuffer.getChannelData(channelIndex),
  );

  for (let frame = 0; frame < audioBuffer.length; frame += 1) {
    let mixedSample = 0;

    for (const channel of channels) {
      mixedSample += channel[frame];
    }

    mono[frame] = mixedSample / channels.length;
  }

  return mono;
}

async function loadRemoteAudioFile(url) {
  const audioBuffer = await decodeAudioData(url, 16000);

  if (audioBuffer.sampleRate !== 16000) {
    throw new Error(`Expected a 16000Hz audio sample, received ${audioBuffer.sampleRate}Hz.`);
  }

  return mixAudioBufferToMono(audioBuffer);
}

function withDeviceOptions(device, options = {}) {
  return {
    ...options,
    device,
  };
}

function extractAssistantText(output) {
  const firstResult = Array.isArray(output) ? output[0] : output;
  const generatedText = firstResult?.generated_text;

  if (Array.isArray(generatedText)) {
    for (let index = generatedText.length - 1; index >= 0; index -= 1) {
      const message = generatedText[index];
      if (message?.role === 'assistant' && typeof message.content === 'string') {
        return cleanGeneratedText(message.content);
      }
    }

    const lastMessage = generatedText[generatedText.length - 1];
    if (typeof lastMessage?.content === 'string') {
      return cleanGeneratedText(lastMessage.content);
    }
  }

  if (typeof generatedText === 'string') {
    return cleanGeneratedText(generatedText);
  }

  return '';
}

export default function App() {
  const supportedBackends = getSupportedExecutionProviderNames();
  const requestedExecutionProviders = getExecutionProviderChainForDevice(REQUESTED_DEVICE);
  const appFallbackDevices = getAppFallbackDevices(supportedBackends);
  const [checks, setChecks] = useState(() =>
    createInitialChecks({
      requestedExecutionProviders,
      appFallbackDevices,
    }),
  );
  const [suiteStatus, setSuiteStatus] = useState('Preparing compatibility suite');
  const [running, setRunning] = useState(false);
  const runSequenceRef = useRef(0);
  const resourcesRef = useRef({
    speechAudio: null,
    speechProcessors: {},
    speechModels: {},
    chatPipelines: {},
  });

  function patchCheck(id, update) {
    setChecks((current) =>
      current.map((check) => (check.id === id ? { ...check, ...update } : check)),
    );
  }

  async function runWithDeviceFallback(testId, runId, invokeForDevice) {
    const attemptedDevices = [];
    const attemptErrors = [];

    for (const device of appFallbackDevices) {
      if (runSequenceRef.current !== runId) {
        return null;
      }

      attemptedDevices.push(device);
      const executionProviders = getExecutionProviderChainForDevice(device);

      patchCheck(testId, {
        attemptedDevices: [...attemptedDevices],
        progress:
          attemptedDevices.length === 1
            ? `Trying ${device} (${formatChain(executionProviders, 'default runtime order')})`
            : `Retrying with ${device} (${formatChain(executionProviders, 'default runtime order')})`,
        resolvedDevice: null,
        resolvedExecutionProviders: null,
        appFallbackUsed: attemptedDevices.length > 1,
        fallbackTarget: attemptedDevices.length > 1 ? device : null,
        fallbackReason:
          attemptErrors.length > 0 ? attemptErrors[attemptErrors.length - 1].message : null,
      });

      try {
        const value = await invokeForDevice(device, (event) => {
          if (runSequenceRef.current !== runId) {
            return;
          }

          patchCheck(testId, {
            attemptedDevices: [...attemptedDevices],
            progress: `${device} | ${formatProgress(event)}`,
          });
        });

        return {
          value,
          resolvedDevice: device,
          resolvedExecutionProviders: executionProviders,
          attemptedDevices: [...attemptedDevices],
          appFallbackUsed: device !== REQUESTED_DEVICE,
          fallbackTarget: device !== REQUESTED_DEVICE ? device : null,
          attemptErrors: [...attemptErrors],
        };
      } catch (error) {
        const compactMessage = getCompactErrorMessage(error);
        const nextDevice = appFallbackDevices[attemptedDevices.length];

        attemptErrors.push({
          device,
          message: compactMessage,
          full: getErrorMessage(error),
        });

        if (runSequenceRef.current !== runId) {
          return null;
        }

        patchCheck(testId, {
          attemptedDevices: [...attemptedDevices],
          appFallbackUsed: true,
          fallbackReason: compactMessage,
          progress: nextDevice
            ? `Attempt on ${device} failed. Retrying with ${nextDevice}.`
            : 'All device attempts failed.',
        });
      }
    }

    throw new Error(
      attemptErrors
        .map(({ device, full }) => `${device}: ${full}`)
        .join('\n\n---\n\n'),
    );
  }

  async function runSpeechTextGeneration(runId) {
    const testId = 'speech-text-generation';

    patchCheck(testId, {
      status: 'Running',
      progress: 'Preparing Granite Speech model and audio sample',
      summary: null,
      details: null,
      error: null,
      attemptedDevices: [],
      resolvedDevice: null,
      resolvedExecutionProviders: null,
      appFallbackUsed: null,
      fallbackTarget: null,
      fallbackReason: null,
    });

    const result = await runWithDeviceFallback(testId, runId, async (device, progressCallback) => {
      if (!resourcesRef.current.speechAudio) {
        patchCheck(testId, {
          progress: 'Fetching and decoding the model-card audio sample',
        });
        resourcesRef.current.speechAudio = await loadRemoteAudioFile(SPEECH_AUDIO_URL);
      }

      if (!resourcesRef.current.speechProcessors[device]) {
        resourcesRef.current.speechProcessors[device] = await AutoProcessor.from_pretrained(
          SPEECH_MODEL_ID,
          {
            progress_callback: progressCallback,
          },
        );
      }

      if (!resourcesRef.current.speechModels[device]) {
        resourcesRef.current.speechModels[device] =
          await GraniteSpeechForConditionalGeneration.from_pretrained(
            SPEECH_MODEL_ID,
            withDeviceOptions(device, {
              dtype: SPEECH_MODEL_DTYPE,
              progress_callback: progressCallback,
            }),
          );
      }

      const processor = resourcesRef.current.speechProcessors[device];
      const model = resourcesRef.current.speechModels[device];
      const audio = resourcesRef.current.speechAudio;
      const text = processor.apply_chat_template(SPEECH_MESSAGES, {
        add_generation_prompt: false,
        tokenize: false,
      });
      const inputs = await processor(text, audio);
      let streamedText = '';

      const generatedIds = await model.generate({
        ...inputs,
        ...SPEECH_GENERATION_OPTIONS,
        streamer: new TextStreamer(processor.tokenizer, {
          skip_prompt: true,
          callback_function: (chunk) => {
            if (runSequenceRef.current !== runId) {
              return;
            }

            streamedText += chunk;
            patchCheck(testId, {
              progress: `${device} | Generating transcript | ${truncateText(cleanGeneratedText(streamedText), 220)}`,
            });
          },
        }),
      });

      const generatedTexts = processor.batch_decode(
        generatedIds.slice(null, [inputs.input_ids.dims.at(-1), null]),
        { skip_special_tokens: true },
      );
      const transcript = cleanGeneratedText(generatedTexts[0] ?? streamedText);

      if (!transcript) {
        throw new Error('The speech model returned an empty transcript.');
      }

      return {
        transcript,
        prompt: SPEECH_MESSAGES[0].content,
        audioUrl: SPEECH_AUDIO_URL,
      };
    });

    if (!result || runSequenceRef.current !== runId) {
      return;
    }

    patchCheck(testId, {
      status: 'Completed',
      progress: 'Speech text generation completed on device',
      summary: truncateText(result.value.transcript, 220),
      details: `Prompt: ${result.value.prompt}\nAudio: ${result.value.audioUrl}`,
      attemptedDevices: result.attemptedDevices,
      resolvedDevice: result.resolvedDevice,
      resolvedExecutionProviders: result.resolvedExecutionProviders,
      appFallbackUsed: result.appFallbackUsed,
      fallbackTarget: result.fallbackTarget,
      fallbackReason:
        result.attemptErrors.length > 0
          ? result.attemptErrors[result.attemptErrors.length - 1].message
          : null,
    });
  }

  async function runChatGeneration(runId) {
    const testId = 'chat-text-generation';

    patchCheck(testId, {
      status: 'Running',
      progress: 'Preparing chat generation pipeline',
      summary: null,
      details: null,
      error: null,
      attemptedDevices: [],
      resolvedDevice: null,
      resolvedExecutionProviders: null,
      appFallbackUsed: null,
      fallbackTarget: null,
      fallbackReason: null,
    });

    const result = await runWithDeviceFallback(testId, runId, async (device, progressCallback) => {
      if (!resourcesRef.current.chatPipelines[device]) {
        resourcesRef.current.chatPipelines[device] = await pipeline(
          'text-generation',
          CHAT_MODEL_ID,
          withDeviceOptions(device, {
            dtype: 'q4',
            progress_callback: progressCallback,
          }),
        );
      }

      const output = await resourcesRef.current.chatPipelines[device](CHAT_MESSAGES, {
        ...CHAT_GENERATION_OPTIONS,
      });
      const assistantText = extractAssistantText(output);

      if (!assistantText) {
        throw new Error('The chat model returned an empty assistant response.');
      }

      return {
        assistantText,
        prompt: CHAT_MESSAGES[1].content,
      };
    });

    if (!result || runSequenceRef.current !== runId) {
      return;
    }

    patchCheck(testId, {
      status: 'Completed',
      progress: 'Chat generation completed on device',
      summary: truncateText(result.value.assistantText, 220),
      details: `Prompt: ${result.value.prompt}`,
      attemptedDevices: result.attemptedDevices,
      resolvedDevice: result.resolvedDevice,
      resolvedExecutionProviders: result.resolvedExecutionProviders,
      appFallbackUsed: result.appFallbackUsed,
      fallbackTarget: result.fallbackTarget,
      fallbackReason:
        result.attemptErrors.length > 0
          ? result.attemptErrors[result.attemptErrors.length - 1].message
          : null,
    });
  }

  async function runSuite() {
    if (running) {
      return;
    }

    const runId = runSequenceRef.current + 1;
    runSequenceRef.current = runId;

    setRunning(true);
    setSuiteStatus('Running compatibility suite');
    setChecks(
      createInitialChecks({
        requestedExecutionProviders,
        appFallbackDevices,
      }),
    );

    let currentTestId = TESTS[0].id;

    try {
      currentTestId = 'speech-text-generation';
      await runSpeechTextGeneration(runId);

      if (runSequenceRef.current !== runId) {
        return;
      }

      currentTestId = 'chat-text-generation';
      await runChatGeneration(runId);

      if (runSequenceRef.current !== runId) {
        return;
      }

      setSuiteStatus('Completed');
    } catch (error) {
      if (runSequenceRef.current !== runId) {
        return;
      }

      setSuiteStatus('Failed');
      patchCheck(currentTestId, {
        status: 'Failed',
        progress: 'See the error output below',
        error: getErrorMessage(error),
      });
    } finally {
      if (runSequenceRef.current === runId) {
        setRunning(false);
      }
    }
  }

  useEffect(() => {
    void runSuite();
  }, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>@automatalabs/react-native-transformers</Text>
          <Text style={styles.title}>Expo compatibility suite</Text>
          <Text style={styles.subtitle}>
            This screen imports <Text style={styles.inlineCode}>@huggingface/transformers</Text>{' '}
            directly and validates Granite Speech transcription plus a chat generation model over
            the RN ONNX backend.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Supported backends</Text>
          <Text style={styles.value}>
            {supportedBackends.length > 0 ? supportedBackends.join(', ') : 'No backends reported'}
          </Text>

          <Text style={styles.label}>Requested device</Text>
          <Text style={styles.value}>{REQUESTED_DEVICE}</Text>

          <Text style={styles.label}>Requested execution provider order</Text>
          <Text style={styles.value}>{formatChain(requestedExecutionProviders, 'default runtime order')}</Text>

          <Text style={styles.label}>App retry order</Text>
          <Text style={styles.value}>{formatChain(appFallbackDevices, 'No app-level fallback configured')}</Text>

          <Text style={styles.label}>Fallback visibility</Text>
          <Text style={styles.value}>{FALLBACK_VISIBILITY_NOTE}</Text>

          <Text style={styles.label}>Suite status</Text>
          <View style={styles.statusRow}>
            {running ? <ActivityIndicator color="#0f172a" /> : null}
            <Text style={styles.statusText}>{suiteStatus}</Text>
          </View>

          <Pressable onPress={runSuite} style={styles.button}>
            <Text style={styles.buttonText}>{running ? 'Running...' : 'Run suite again'}</Text>
          </Pressable>
        </View>

        {checks.map((check) => (
          <View key={check.id} style={[styles.card, check.status === 'Failed' && styles.errorCard]}>
            <Text style={styles.label}>{check.title}</Text>
            <Text style={styles.value}>{check.description}</Text>

            <Text style={styles.label}>Model</Text>
            <Text style={styles.value}>{check.model}</Text>

            <Text style={styles.label}>Requested device</Text>
            <Text style={styles.value}>{check.requestedDevice}</Text>

            <Text style={styles.label}>Requested execution provider order</Text>
            <Text style={styles.value}>
              {formatChain(check.requestedExecutionProviders, 'default runtime order')}
            </Text>

            <Text style={styles.label}>App retry order</Text>
            <Text style={styles.value}>
              {formatChain(check.appFallbackDevices, 'No app-level fallback configured')}
            </Text>

            <Text style={styles.label}>Attempt path</Text>
            <Text style={styles.value}>{formatChain(check.attemptedDevices)}</Text>

            <Text style={styles.label}>Final device</Text>
            <Text style={styles.value}>{check.resolvedDevice ?? 'Not resolved yet'}</Text>

            <Text style={styles.label}>Final execution provider order</Text>
            <Text style={styles.value}>
              {formatChain(check.resolvedExecutionProviders, 'Not resolved yet')}
            </Text>

            <Text style={styles.label}>App fallback used</Text>
            <Text style={styles.value}>
              {check.appFallbackUsed == null ? 'Not determined yet' : check.appFallbackUsed ? 'Yes' : 'No'}
            </Text>

            {check.fallbackTarget ? (
              <>
                <Text style={styles.label}>Fallback target</Text>
                <Text style={styles.value}>{check.fallbackTarget}</Text>
              </>
            ) : null}

            {check.fallbackReason ? (
              <>
                <Text style={styles.label}>Fallback trigger</Text>
                <Text style={styles.value}>{check.fallbackReason}</Text>
              </>
            ) : null}

            <Text style={styles.label}>Status</Text>
            <Text style={styles.statusText}>{check.status}</Text>

            <Text style={styles.label}>Progress</Text>
            <Text style={styles.value}>{check.progress}</Text>

            {check.summary ? (
              <>
                <Text style={styles.label}>Summary</Text>
                <Text style={styles.statusText}>{check.summary}</Text>
              </>
            ) : null}

            {check.details ? (
              <>
                <Text style={styles.label}>Details</Text>
                <Text style={styles.value}>{check.details}</Text>
              </>
            ) : null}

            {check.error ? (
              <>
                <Text style={styles.label}>Error</Text>
                <Text style={styles.code}>{check.error}</Text>
              </>
            ) : null}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f3efe7',
  },
  content: {
    padding: 20,
    gap: 16,
  },
  hero: {
    marginTop: 12,
    gap: 8,
  },
  eyebrow: {
    color: '#8c4a1f',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  title: {
    color: '#111827',
    fontSize: 34,
    fontWeight: '800',
    lineHeight: 38,
  },
  subtitle: {
    color: '#4b5563',
    fontSize: 16,
    lineHeight: 24,
  },
  inlineCode: {
    fontFamily: 'Courier',
    fontSize: 15,
  },
  card: {
    backgroundColor: '#fff7ed',
    borderColor: '#f2d7bc',
    borderRadius: 22,
    borderWidth: 1,
    gap: 8,
    padding: 18,
  },
  errorCard: {
    backgroundColor: '#fff1f2',
    borderColor: '#fecaca',
  },
  label: {
    color: '#8b93a7',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginTop: 6,
    textTransform: 'uppercase',
  },
  value: {
    color: '#334155',
    fontSize: 16,
    lineHeight: 24,
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  statusText: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
  },
  button: {
    alignItems: 'center',
    backgroundColor: '#0f172a',
    borderRadius: 999,
    marginTop: 10,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  code: {
    color: '#1f2937',
    fontFamily: 'Courier',
    fontSize: 13,
    lineHeight: 19,
  },
});
