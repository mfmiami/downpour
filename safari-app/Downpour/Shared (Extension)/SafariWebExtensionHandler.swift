//
//  SafariWebExtensionHandler.swift
//  Shared (Extension)
//

import SafariServices
import os.log

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    private let youtubeManager = YoutubeJobManager.shared
    private let nativeDownloadManager = NativeDownloadManager.shared

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
            case "downloadUrlBegin":  responsePayload = downloadUrlBegin(dict)
            case "downloadUrlStatus": responsePayload = downloadUrlStatus(dict)
            case "downloadUrlAbort":  responsePayload = downloadUrlAbort(dict)
            default:                  responsePayload = ["echo": message ?? ""]
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
            guard FileManager.default.fileExists(atPath: dest.path),
                  let attrs = try? FileManager.default.attributesOfItem(atPath: dest.path),
                  let size = attrs[.size] as? NSNumber, size.intValue > 0 else {
                return ["error": "File was not created"]
            }
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
            guard FileManager.default.fileExists(atPath: dest.path),
                  let attrs = try? FileManager.default.attributesOfItem(atPath: dest.path),
                  let size = attrs[.size] as? NSNumber, size.intValue > 0 else {
                return ["error": "File was not created"]
            }
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

    private func downloadUrlBegin(_ dict: [String: Any]) -> [String: Any] {
        guard let urlStr = dict["url"] as? String, let url = URL(string: urlStr) else {
            return ["error": "No URL provided"]
        }
        guard let downloads = downloadsDir() else {
            return ["error": "Could not locate Downloads folder"]
        }
        let filename = sanitize(dict["filename"] as? String ?? "video.mp4")
        let referer = dict["referer"] as? String ?? "https://www.erome.com/"
        var request = URLRequest(url: url)
        request.setValue(referer, forHTTPHeaderField: "Referer")
        request.setValue(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
            forHTTPHeaderField: "User-Agent"
        )
        let dest = uniqueURL(in: downloads, filename: filename)
        let token = nativeDownloadManager.begin(request: request, destURL: dest)
        return ["ok": true, "token": token]
    }

    private func downloadUrlStatus(_ dict: [String: Any]) -> [String: Any] {
        guard let token = dict["token"] as? String else { return ["error": "No token"] }
        guard let payload = nativeDownloadManager.status(token: token) else {
            return ["error": "Unknown download job"]
        }
        if let state = payload["state"] as? String,
           state == "done" || state == "error" || state == "cancelled" {
            nativeDownloadManager.remove(token: token)
        }
        return payload
    }

    private func downloadUrlAbort(_ dict: [String: Any]) -> [String: Any] {
        guard let token = dict["token"] as? String else { return ["error": "No token"] }
        nativeDownloadManager.abort(token: token)
        return ["ok": true]
    }
}

// MARK: - Native URL downloads with progress (erome CDN, etc.)

final class NativeDownloadManager: NSObject, URLSessionDownloadDelegate {
    static let shared = NativeDownloadManager()

    private enum State: String {
        case running, saving, done, error, cancelled
    }

    private struct Record {
        var state: State
        var progress: Int
        var message: String
        var path: String?
        var error: String?
        var destURL: URL
        var cancelled: Bool
    }

    private let lock = NSLock()
    private var records: [String: Record] = [:]
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 120
        config.timeoutIntervalForResource = 3600
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    private override init() {
        super.init()
    }

    func begin(request: URLRequest, destURL: URL) -> String {
        let token = UUID().uuidString
        let task = session.downloadTask(with: request)
        task.taskDescription = token
        lock.lock()
        records[token] = Record(
            state: .running,
            progress: 0,
            message: "downloading…",
            path: nil,
            error: nil,
            destURL: destURL,
            cancelled: false
        )
        lock.unlock()
        task.resume()
        return token
    }

    func status(token: String) -> [String: Any]? {
        lock.lock()
        defer { lock.unlock() }
        guard let record = records[token] else { return nil }
        var payload: [String: Any] = [
            "ok": true,
            "state": record.state.rawValue,
            "progress": record.progress,
            "message": record.message
        ]
        if let path = record.path { payload["path"] = path }
        if let error = record.error { payload["error"] = error }
        return payload
    }

    func abort(token: String) {
        lock.lock()
        if var record = records[token] {
            record.cancelled = true
            record.state = .cancelled
            record.message = "cancelled"
            records[token] = record
        }
        lock.unlock()
        session.getAllTasks { tasks in
            for task in tasks where task.taskDescription == token {
                task.cancel()
            }
        }
    }

    func remove(token: String) {
        lock.lock()
        records.removeValue(forKey: token)
        lock.unlock()
    }

    func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didWriteData bytesWritten: Int64,
        totalBytesWritten: Int64,
        totalBytesExpectedToWrite: Int64
    ) {
        guard let token = downloadTask.taskDescription else { return }
        lock.lock()
        defer { lock.unlock() }
        guard var record = records[token], !record.cancelled else { return }
        if totalBytesExpectedToWrite > 0 {
            let pct = Int((Double(totalBytesWritten) / Double(totalBytesExpectedToWrite)) * 100)
            record.progress = min(98, max(0, pct))
            record.message = "downloading \(record.progress)%…"
        } else {
            let mb = max(1, Int(totalBytesWritten / 1_048_576))
            record.progress = 0
            record.message = "downloading \(mb) MB…"
        }
        records[token] = record
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard let token = downloadTask.taskDescription else { return }
        lock.lock()
        guard var record = records[token] else {
            lock.unlock()
            return
        }
        record.state = .saving
        record.progress = 99
        record.message = "saving…"
        let dest = record.destURL
        lock.unlock()

        do {
            if FileManager.default.fileExists(atPath: dest.path) {
                try FileManager.default.removeItem(at: dest)
            }
            try FileManager.default.moveItem(at: location, to: dest)
            lock.lock()
            record.state = .done
            record.progress = 100
            record.message = "done"
            record.path = dest.path
            records[token] = record
            lock.unlock()
            os_log(.default, "Downloaded media to %@", dest.path)
        } catch {
            lock.lock()
            record.state = .error
            record.error = "Save failed: \(error.localizedDescription)"
            record.message = record.error ?? "Save failed"
            records[token] = record
            lock.unlock()
            try? FileManager.default.removeItem(at: location)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let token = task.taskDescription else { return }
        guard let error = error else { return }
        lock.lock()
        defer { lock.unlock() }
        guard var record = records[token] else { return }
        if record.state == .done || record.state == .cancelled { return }
        if (error as NSError).code == NSURLErrorCancelled {
            record.state = .cancelled
            record.message = "cancelled"
        } else {
            record.state = .error
            record.error = error.localizedDescription
            record.message = record.error ?? "Download failed"
        }
        records[token] = record
    }
}