//
//  SafariWebExtensionHandler.swift
//  Shared (Extension)
//

import SafariServices
import os.log

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    private let youtubeManager = YoutubeJobManager.shared

    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem
        let message: Any?
        if #available(macOS 11.0, *) {
            message = request?.userInfo?[SFExtensionMessageKey]
        } else {
            message = request?.userInfo?["message"]
        }

        var responsePayload: [String: Any]
        if let dict = message as? [String: Any], let type = dict["type"] as? String {
            switch type {
            case "saveToDownloads": responsePayload = saveToDownloads(dict)
            case "saveBegin":       responsePayload = saveBegin(dict)
            case "saveChunk":       responsePayload = saveChunk(dict)
            case "saveEnd":         responsePayload = saveEnd(dict)
            case "saveAbort":       responsePayload = saveAbort(dict)
            case "youtubeBegin":    responsePayload = youtubeBegin(dict)
            case "youtubeStatus":   responsePayload = youtubeStatus(dict)
            case "youtubeAbort":    responsePayload = youtubeAbort(dict)
            default:                responsePayload = ["echo": message ?? ""]
            }
        } else {
            responsePayload = ["echo": message ?? ""]
        }

        let response = NSExtensionItem()
        if #available(macOS 11.0, *) {
            response.userInfo = [ SFExtensionMessageKey: responsePayload ]
        } else {
            response.userInfo = [ "message": responsePayload ]
        }
        context.completeRequest(returningItems: [ response ], completionHandler: nil)
    }

    private func saveToDownloads(_ dict: [String: Any]) -> [String: Any] {
        guard let b64 = dict["data"] as? String, !b64.isEmpty else {
            return ["error": "No file data provided"]
        }
        guard let data = Data(base64Encoded: b64) else {
            return ["error": "Could not decode file data"]
        }

        let filename = sanitize(dict["filename"] as? String ?? "video.mp4")
        guard let downloads = downloadsDir() else {
            return ["error": "Could not locate Downloads folder"]
        }

        let dest = uniqueURL(in: downloads, filename: filename)
        do {
            try data.write(to: dest, options: .atomic)
            os_log(.default, "Saved video to %@", dest.path)
            return ["ok": true, "path": dest.path, "bytes": data.count]
        } catch {
            os_log(.error, "Failed to save video: %@", error.localizedDescription)
            return ["error": "Write failed: \(error.localizedDescription)"]
        }
    }

    private func downloadsDir() -> URL? {
        FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
    }

    private func saveBegin(_ dict: [String: Any]) -> [String: Any] {
        guard let dir = downloadsDir() else { return ["error": "Could not locate Downloads folder"] }
        let token = dir.appendingPathComponent(".vsd-\(UUID().uuidString).part")
        if !FileManager.default.createFile(atPath: token.path, contents: nil) {
            return ["error": "Could not create temp file"]
        }
        return ["ok": true, "token": token.path]
    }

    private func saveChunk(_ dict: [String: Any]) -> [String: Any] {
        guard let tokenPath = dict["token"] as? String else { return ["error": "No token"] }
        guard let b64 = dict["data"] as? String, let data = Data(base64Encoded: b64) else {
            return ["error": "Could not decode chunk data"]
        }
        let url = URL(fileURLWithPath: tokenPath)
        guard let fh = try? FileHandle(forWritingTo: url) else { return ["error": "Temp file missing"] }
        defer { fh.closeFile() }
        do {
            if #available(macOS 10.15.4, *) {
                try fh.seekToEnd()
                try fh.write(contentsOf: data)
            } else {
                fh.seekToEndOfFile()
                fh.write(data)
            }
            return ["ok": true]
        } catch {
            return ["error": "Append failed: \(error.localizedDescription)"]
        }
    }

    private func saveEnd(_ dict: [String: Any]) -> [String: Any] {
        guard let tokenPath = dict["token"] as? String else { return ["error": "No token"] }
        guard let dir = downloadsDir() else { return ["error": "Could not locate Downloads folder"] }
        let filename = sanitize(dict["filename"] as? String ?? "video.mp4")
        let temp = URL(fileURLWithPath: tokenPath)
        let dest = uniqueURL(in: dir, filename: filename)
        do {
            try FileManager.default.moveItem(at: temp, to: dest)
            os_log(.default, "Saved video to %@", dest.path)
            return ["ok": true, "path": dest.path]
        } catch {
            try? FileManager.default.removeItem(at: temp)
            return ["error": "Finalize failed: \(error.localizedDescription)"]
        }
    }

    private func saveAbort(_ dict: [String: Any]) -> [String: Any] {
        if let tokenPath = dict["token"] as? String {
            try? FileManager.default.removeItem(at: URL(fileURLWithPath: tokenPath))
        }
        return ["ok": true]
    }

    private static let knownExtensions = [
        "mp4", "webm", "mov", "mkv", "m4v", "m4a",
        "jpg", "jpeg", "png", "webp", "gif", "heic"
    ]

    private func sanitize(_ name: String, defaultExt: String = "mp4") -> String {
        let invalid = CharacterSet(charactersIn: "/\\:*?\"<>|")
        var cleaned = name.components(separatedBy: invalid).joined(separator: "_")
        cleaned = cleaned.trimmingCharacters(in: .whitespacesAndNewlines)
        if cleaned.isEmpty { cleaned = "download.\(defaultExt)" }
        let lower = cleaned.lowercased()
        let hasKnownExt = Self.knownExtensions.contains { lower.hasSuffix(".\($0)") }
        if !hasKnownExt { cleaned += ".\(defaultExt)" }
        return cleaned
    }

    private func uniqueURL(in dir: URL, filename: String) -> URL {
        YoutubeJobManager.uniqueURL(in: dir, filename: filename)
    }

    private func youtubeBegin(_ dict: [String: Any]) -> [String: Any] {
        guard let url = dict["url"] as? String, !url.isEmpty else {
            return ["error": "No YouTube URL provided"]
        }
        guard let downloads = downloadsDir() else {
            return ["error": "Could not locate Downloads folder"]
        }
        let filename = sanitize(dict["filename"] as? String ?? "video.mp4")
        let quality = (dict["quality"] as? String == "best") ? "best" : "normal"
        do {
            let record = try youtubeManager.createJob(url: url, filename: filename, quality: quality, downloads: downloads)
            youtubeManager.postJobNotification(token: record.token)
            youtubeManager.wakeHostApp()
            return ["ok": true, "token": record.token]
        } catch {
            return ["error": "Could not queue YouTube download: \(error.localizedDescription)"]
        }
    }

    private func youtubeStatus(_ dict: [String: Any]) -> [String: Any] {
        guard let token = dict["token"] as? String else { return ["error": "No token"] }
        guard let record = youtubeManager.readJob(token: token) else {
            return ["error": "Unknown YouTube download job"]
        }
        let payload = youtubeManager.statusPayload(for: record)
        if record.state == .done || record.state == .error || record.state == .cancelled {
            youtubeManager.removeJob(token: token)
        }
        return payload
    }

    private func youtubeAbort(_ dict: [String: Any]) -> [String: Any] {
        guard let token = dict["token"] as? String else { return ["error": "No token"] }
        youtubeManager.requestCancellation(token: token)
        return ["ok": true]
    }
}