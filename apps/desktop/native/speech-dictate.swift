import AppKit
import AVFoundation
import Darwin
import Foundation
import Speech

let args = CommandLine.arguments
let live = args.count >= 3 && args[1] == "--live"
if !live && args.count < 2 {
  FileHandle.standardError.write(Data("usage: speech-dictate <wav-file> [locale]\n".utf8))
  FileHandle.standardError.write(Data("       speech-dictate --live <pcm-fifo> [locale]\n".utf8))
  exit(2)
}

let nsApp = NSApplication.shared
nsApp.setActivationPolicy(.accessory)
nsApp.finishLaunching()

if Bundle.main.object(forInfoDictionaryKey: "NSSpeechRecognitionUsageDescription") == nil {
  FileHandle.standardError.write(Data("missing-usage-description\n".utf8))
  exit(1)
}

let localeId = live
  ? (args.count > 3 ? args[3] : Locale.current.identifier)
  : (args.count > 2 ? args[2] : Locale.current.identifier)
var finished = false

func emit(_ kind: String, _ text: String = "") {
  let obj: [String: String] = ["k": kind, "t": text]
  guard let data = try? JSONSerialization.data(withJSONObject: obj, options: []),
    let line = String(data: data, encoding: .utf8)
  else { return }
  FileHandle.standardOutput.write(Data((line + "\n").utf8))
  fflush(stdout)
}

func finish(_ code: Int32, err: String?, text: String?) {
  guard !finished else { return }
  finished = true
  let trimmed = text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
  if live {
    if !trimmed.isEmpty { emit("f", trimmed) }
    if let err, !err.isEmpty, trimmed.isEmpty { emit("e", err) }
    exit(code)
  }
  if !trimmed.isEmpty {
    FileHandle.standardOutput.write(Data((trimmed + "\n").utf8))
    exit(0)
  }
  if let err, !err.isEmpty {
    FileHandle.standardError.write(Data((err + "\n").utf8))
  }
  exit(code)
}

func authorize(_ then: @escaping (SFSpeechRecognizer) -> Void) {
  SFSpeechRecognizer.requestAuthorization { status in
    DispatchQueue.main.async {
      guard status == .authorized else {
        finish(1, err: "not-authorized", text: nil)
        return
      }
      let rec =
        SFSpeechRecognizer(locale: Locale(identifier: localeId)) ?? SFSpeechRecognizer()
      guard let rec, rec.isAvailable else {
        finish(1, err: "unavailable", text: nil)
        return
      }
      then(rec)
    }
  }
}

func appendPcm16(_ data: Data, request: SFSpeechAudioBufferRecognitionRequest, format: AVAudioFormat) {
  let frames = data.count / MemoryLayout<Int16>.size
  guard frames > 0,
    let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(frames))
  else { return }
  buffer.frameLength = AVAudioFrameCount(frames)
  data.withUnsafeBytes { raw in
    guard let src = raw.bindMemory(to: Int16.self).baseAddress,
      let dst = buffer.int16ChannelData?[0]
    else { return }
    dst.update(from: src, count: frames)
  }
  request.append(buffer)
}

if live {
  let fifoPath = args[2]
  var lastText = ""
  var ended = false
  DispatchQueue.main.asyncAfter(deadline: .now() + 600) {
    finish(1, err: "timeout", text: lastText.isEmpty ? nil : lastText)
  }
  authorize { rec in
    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    request.taskHint = .dictation
    if rec.supportsOnDeviceRecognition {
      request.requiresOnDeviceRecognition = true
    }
    guard
      let format = AVAudioFormat(
        commonFormat: .pcmFormatInt16, sampleRate: 16_000, channels: 1, interleaved: true)
    else {
      finish(1, err: "unavailable", text: nil)
      return
    }
    rec.recognitionTask(with: request) { result, error in
      if let error {
        finish(lastText.isEmpty ? 1 : 0, err: error.localizedDescription, text: lastText.isEmpty ? nil : lastText)
        return
      }
      guard let result else { return }
      let text = result.bestTranscription.formattedString
      lastText = text
      emit(result.isFinal ? "f" : "p", text)
      if result.isFinal && ended { finish(0, err: nil, text: text) }
    }
    guard let handle = FileHandle(forReadingAtPath: fifoPath) else {
      finish(1, err: "unavailable", text: nil)
      return
    }
    emit("r")
    DispatchQueue.global(qos: .userInitiated).async {
      while true {
        let data = handle.readData(ofLength: 8192)
        if data.isEmpty {
          DispatchQueue.main.async {
            ended = true
            request.endAudio()
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
              finish(
                lastText.isEmpty ? 1 : 0,
                err: lastText.isEmpty ? "No speech detected" : nil,
                text: lastText.isEmpty ? nil : lastText)
            }
          }
          break
        }
        appendPcm16(data, request: request, format: format)
      }
    }
  }
} else {
  let url = URL(fileURLWithPath: args[1])
  DispatchQueue.main.asyncAfter(deadline: .now() + 45) {
    finish(1, err: "timeout", text: nil)
  }
  authorize { rec in
    let request = SFSpeechURLRecognitionRequest(url: url)
    request.shouldReportPartialResults = false
    rec.recognitionTask(with: request) { result, error in
      if let error {
        finish(1, err: error.localizedDescription, text: nil)
        return
      }
      guard let result, result.isFinal else { return }
      finish(0, err: nil, text: result.bestTranscription.formattedString)
    }
  }
}

RunLoop.main.run()
