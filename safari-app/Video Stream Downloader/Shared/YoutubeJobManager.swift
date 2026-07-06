//
//  YoutubeJobManager.swift
//  Downpour
//

import Foundation
import os.log
#if os(macOS)
import AppKit
#endif

enum YoutubeJobState: String, Codable {
    case pending, running, done, error, cancelled
}

struct YoutubeJobRecord: Codable {
    var token: String
    var url: String
    var filename: String
    var outputBase: String
    var quality: String?
    var state: YoutubeJobState
    var progress: Int
    var message: String
    var resultPath: String?
    var error: String?
    var pid: Int32?
}

final class YoutubeJobManager {
    static let shared = YoutubeJobManager()
    static let appGroupID = "group.com.dtek.videostreamdownloader"
    static let notificationName = Notification.Name("com.dtek.videostreamdownloader.youtubeJobEnqueued")
    static let hostBundleID = "com.dtek.videostreamdownloader"

    private let lock = NSLock()
    private let fm = FileManager.default

    private init() {}

    func jobsDirectory() throws -> URL {
        guard let base = fm.containerURL(forSecurityApplicationGroupIdentifier: Self.appGroupID) else {
            throw NSError(domain: "YoutubeJob", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "App Group container unavailable"])
        }
        let dir = base.appendingPathComponent("youtube-jobs", isDirectory: true)
        if !fm.fileExists(atPath: dir.path) {
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir
    }

    func createJob(url: String, filename: String, quality: String, downloads: URL) throws -> YoutubeJobRecord {
        let token = UUID().uuidString
        let outputBase = Self.uniqueURL(in: downloads, filename: filename).deletingPathExtension().path
        let record = YoutubeJobRecord(
            token: token,
            url: url,
            filename: filename,
            outputBase: outputBase,
            quality: quality,
            state: .pending,
            progress: 0,
            message: "queued…",
            resultPath: nil,
            error: nil,
            pid: nil
        )
        try writeJob(record)
        return record
    }

    func readJob(token: String) -> YoutubeJobRecord? {
        lock.lock()
        defer { lock.unlock() }
        guard let url = try? jobFileURL(token: token),
              let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(YoutubeJobRecord.self, from: data)
    }

    func writeJob(_ record: YoutubeJobRecord) throws {
        lock.lock()
        defer { lock.unlock() }
        let url = try jobFileURL(token: record.token)
        let data = try JSONEncoder().encode(record)
        try data.write(to: url, options: .atomic)
    }

    func listJobs(withState state: YoutubeJobState) -> [YoutubeJobRecord] {
        guard let dir = try? jobsDirectory() else { return [] }
        guard let files = try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) else { return [] }
        return files.compactMap { file -> YoutubeJobRecord? in
            guard file.pathExtension == "json",
                  let data = try? Data(contentsOf: file),
                  let record = try? JSONDecoder().decode(YoutubeJobRecord.self, from: data),
                  record.state == state else { return nil }
            return record
        }
    }

    func requestCancellation(token: String) {
        guard var record = readJob(token: token) else { return }
        record.state = .cancelled
        record.message = "cancelled"
        try? writeJob(record)
    }

    func statusPayload(for record: YoutubeJobRecord) -> [String: Any] {
        var payload: [String: Any] = [
            "ok": true,
            "state": record.state.rawValue,
            "progress": record.progress,
            "message": record.message
        ]
        if let resultPath = record.resultPath { payload["path"] = resultPath }
        if let error = record.error { payload["error"] = error }
        return payload
    }

    func postJobNotification(token: String) {
        DistributedNotificationCenter.default().post(
            name: Self.notificationName,
            object: nil,
            userInfo: ["token": token]
        )
    }

    #if os(macOS)
    func wakeHostApp() {
        let launched = NSWorkspace.shared.launchApplication(
            withBundleIdentifier: Self.hostBundleID,
            options: [.withoutActivation, .andHide],
            additionalEventParamDescriptor: nil,
            launchIdentifier: nil
        )
        if !launched {
            os_log(.error, "Failed to launch host app for bundle id %@", Self.hostBundleID)
        }
    }
    #endif

    func removeJob(token: String) {
        guard let url = try? jobFileURL(token: token) else { return }
        try? fm.removeItem(at: url)
    }

    private func jobFileURL(token: String) throws -> URL {
        try jobsDirectory().appendingPathComponent("\(token).json")
    }

    static func uniqueURL(in dir: URL, filename: String) -> URL {
        let fm = FileManager.default
        let base = (filename as NSString).deletingPathExtension
        let ext = (filename as NSString).pathExtension
        var candidate = dir.appendingPathComponent(filename)
        var i = 1
        while fm.fileExists(atPath: candidate.path) {
            candidate = dir.appendingPathComponent("\(base) (\(i)).\(ext)")
            i += 1
        }
        return candidate
    }
}