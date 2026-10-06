import AppKit
import Foundation
import Speech

let args = CommandLine.arguments
guard args.count >= 2 else {
  FileHandle.standardError.write(Data("usage: speech-dictate <wav-file> [locale]\n".utf8))
  exit(2)
}

let nsApp = NSApplication.shared
nsApp.setActivationPolicy(.accessory)

let url = URL(fileURLWithPath: args[1])
let localeId = args.count > 2 ? args[2] : Locale.current.identifier
var finished = false

func finish(_ code: Int32, err: String?, text: String?) {
  guard !finished else { return }
  finished = true
  let trimmed = text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
  if !trimmed.isEmpty {
    FileHandle.standardOutput.write(Data((trimmed + "\n").utf8))
    exit(0)
  }
  if let err, !err.isEmpty {
    FileHandle.standardError.write(Data((err + "\n").utf8))
  }
  exit(code)
}

DispatchQueue.main.asyncAfter(deadline: .now() + 45) {
  finish(1, err: "timeout", text: nil)
}

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
