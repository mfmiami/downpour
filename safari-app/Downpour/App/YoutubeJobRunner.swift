//
//  YoutubeJobRunner.swift
//  App
//

import Cocoa
import os.log

final class YoutubeJobRunner {
    static let shared = YoutubeJobRunner()
    private static let maxConcurrentJobs = 2

    private let manager = YoutubeJobManager.shared
    private let queue = DispatchQueue(label: "youtube-job-runner")
    private var activeTokens = Set<String>()
    private let activeLock = NSLock()

    private init() {}

    func start() {
        DistributedNotificationCenter.default().addObserver(
            forName: YoutubeJobManager.notificationName,
            object: nil,
            queue: nil
        ) { [weak self] _ in
            self?.processPendingJobs()
        }
        processPendingJobs()
    }

    func hasActiveJobs() -> Bool {
        activeLock.lock()
        defer { activeLock.unlock() }
        return !activeTokens.isEmpty
    }

    func processPendingJobs() {
        queue.async { [weak self] in
            guard let self else { return }
            let slots = Self.maxConcurrentJobs - self.activeJobCount()
            guard slots > 0 else { return }
            for job in self.manager.listJobs(withState: .pending).prefix(slots) {
                self.runJob(job)
            }
        }
    }

    private func activeJobCount() -> Int {
        activeLock.lock()
        defer { activeLock.unlock() }
        return activeTokens.count
    }

    private func runJob(_ initial: YoutubeJobRecord) {
        activeLock.lock()
        if activeTokens.contains(initial.token) {
            activeLock.unlock()
            return
        }
        activeTokens.insert(initial.token)
        activeLock.unlock()

        guard let python = Self.bundledPythonPath(),
              let script = Bundle.main.path(forResource: "yt-dlp", ofType: "py") else {
            failJob(token: initial.token, message: "Bundled Python or yt-dlp.py not found in app")
            removeActive(initial.token)
            return
        }

        var record = initial
        record.state = .running
        record.message = "starting yt-dlp…"
        try? manager.writeJob(record)

        let process = Process()
        let pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: python)
        var args = ["-u", script, "--no-playlist", "--newline", "-o", record.outputBase + ".%(ext)s"]
        args.append(contentsOf: Self.ytDlpArgs(for: record.quality ?? "normal", url: record.url))
        args.append(record.url)
        process.arguments = args
        var env = ProcessInfo.processInfo.environment
        env["PYTHONUNBUFFERED"] = "1"
        if let pythonHome = Self.bundledPythonHome() {
            env["PYTHONHOME"] = pythonHome
        }
        process.environment = env
        process.standardOutput = pipe
        process.standardError = pipe

        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            guard let self else { return }
            let data = handle.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
            self.parseOutput(token: record.token, text: text)
        }

        process.terminationHandler = { [weak self] proc in
            guard let self else { return }
            pipe.fileHandleForReading.readabilityHandler = nil
            self.queue.async {
                self.finishJob(token: record.token, exitCode: proc.terminationStatus)
                self.removeActive(record.token)
            }
        }

        do {
            try process.run()
            record.pid = process.processIdentifier
            record.message = "downloading…"
            try? manager.writeJob(record)
            self.watchCancellation(token: record.token, process: process)
        } catch {
            failJob(token: record.token, message: "Failed to start yt-dlp: \(error.localizedDescription)")
            removeActive(record.token)
        }
    }

    private func parseOutput(token: String, text: String) {
        queue.async { [weak self] in
            guard let self, var record = self.manager.readJob(token: token) else { return }
            if record.state == .cancelled || record.state == .done || record.state == .error { return }

            if let latest = self.manager.readJob(token: token), latest.state == .cancelled {
                self.terminateIfRunning(pid: record.pid)
                return
            }

            for raw in text.split(whereSeparator: \.isNewline) {
                let line = String(raw)
                if let pct = Self.parsePercent(line) {
                    record.progress = pct
                    record.message = "downloading \(pct)%"
                } else if line.contains("[Merger]") {
                    record.message = "merging audio/video…"
                    record.progress = max(record.progress, 95)
                } else if line.contains("ERROR") || line.contains("error:") {
                    record.error = line.trimmingCharacters(in: .whitespacesAndNewlines)
                } else if line.contains("[download] Destination:") || line.contains("Downloading webpage") {
                    record.message = line.trimmingCharacters(in: .whitespacesAndNewlines)
                }
            }
            try? self.manager.writeJob(record)
        }
    }

    private func finishJob(token: String, exitCode: Int32) {
        guard var record = manager.readJob(token: token) else { return }
        if record.state == .cancelled { return }

        if exitCode == 0 {
            if let path = Self.locateOutput(for: record.outputBase) {
                record.resultPath = path.path
                record.state = .done
                record.progress = 100
                record.message = "done"
                os_log(.default, "YouTube download saved to %@", path.path)
            } else {
                record.state = .error
                record.error = record.error ?? "yt-dlp finished but output file was not found"
            }
        } else {
            record.state = .error
            if record.error == nil {
                record.error = "yt-dlp exited with status \(exitCode)"
            }
        }
        record.pid = nil
        try? manager.writeJob(record)
    }

    private func failJob(token: String, message: String) {
        guard var record = manager.readJob(token: token) else { return }
        record.state = .error
        record.error = message
        record.pid = nil
        try? manager.writeJob(record)
    }

    private func watchCancellation(token: String, process: Process) {
        queue.asyncAfter(deadline: .now() + 1) { [weak self] in
            guard let self else { return }
            guard process.isRunning else { return }
            if let record = self.manager.readJob(token: token), record.state == .cancelled {
                process.terminate()
                return
            }
            self.watchCancellation(token: token, process: process)
        }
    }

    private func terminateIfRunning(pid: Int32?) {
        guard let pid, pid > 0 else { return }
        kill(pid, SIGTERM)
    }

    private func removeActive(_ token: String) {
        activeLock.lock()
        activeTokens.remove(token)
        activeLock.unlock()
        processPendingJobs()
    }

    private static func isSocialMediaUrl(_ url: String) -> Bool {
        let lower = url.lowercased()
        return lower.contains("tiktok.com")
            || lower.contains("twitter.com")
            || lower.contains("x.com")
            || lower.contains("instagram.com")
    }

    private static func ytDlpArgs(for quality: String?, url: String) -> [String] {
        if isSocialMediaUrl(url) {
            var args = [
                "--cookies-from-browser", "safari",
                "--impersonate", "chrome-133:macos-15",
                "--retries", "3",
                "--fragment-retries", "3"
            ]
            if quality == "best" {
                args.append(contentsOf: ["-f", "bv*+ba/b", "--merge-output-format", "mp4"])
                if let ffmpegDir = bundledFfmpegDirectory() {
                    args.append(contentsOf: ["--ffmpeg-location", ffmpegDir])
                }
            } else {
                args.append(contentsOf: ["-f", "best[height<=720]/best/b"])
            }
            return args
        }
        if quality == "best" {
            var args = [
                "-f", "bv*+ba/b",
                "--merge-output-format", "mp4"
            ]
            if let ffmpegDir = bundledFfmpegDirectory() {
                args.append(contentsOf: ["--ffmpeg-location", ffmpegDir])
            }
            return args
        }
        return [
            "-f",
            "b[height<=720][ext=mp4][vcodec!=none][acodec!=none]/b[height<=720][ext=mp4]/b[height<=720]/b[ext=mp4]/b"
        ]
    }

    private static func bundledFfmpegDirectory() -> String? {
        let fm = FileManager.default
        if let dir = Bundle.main.resourceURL?.appendingPathComponent("ffmpeg").path {
            let binary = (dir as NSString).appendingPathComponent("ffmpeg")
            if fm.isExecutableFile(atPath: binary) { return dir }
        }
        if let binary = Bundle.main.path(forResource: "ffmpeg", ofType: nil),
           fm.isExecutableFile(atPath: binary) {
            return (binary as NSString).deletingLastPathComponent
        }
        return nil
    }

    private static func bundledPythonPath() -> String? {
        let fm = FileManager.default
        let candidates = [
            Bundle.main.path(forResource: "python/bin/python3", ofType: nil),
            Bundle.main.resourceURL?.appendingPathComponent("python/bin/python3").path
        ]
        for path in candidates {
            if let path, fm.isExecutableFile(atPath: path) { return path }
        }
        return nil
    }

    private static func locateOutput(for outputBase: String) -> URL? {
        let fm = FileManager.default
        let baseURL = URL(fileURLWithPath: outputBase)
        let exact = ["mp4", "webm", "mkv", "m4a"].map { baseURL.appendingPathExtension($0) }
        if let hit = exact.first(where: { fm.fileExists(atPath: $0.path) }) { return hit }

        let dir = baseURL.deletingLastPathComponent()
        let prefix = baseURL.lastPathComponent
        guard let names = try? fm.contentsOfDirectory(atPath: dir.path) else { return nil }
        let matches = names
            .filter { $0.hasPrefix(prefix) && !$0.hasSuffix(".part") }
            .sorted { lhs, rhs in
                let leftMP4 = lhs.hasSuffix(".mp4")
                let rightMP4 = rhs.hasSuffix(".mp4")
                if leftMP4 != rightMP4 { return leftMP4 }
                return lhs < rhs
            }
        if let name = matches.first {
            return dir.appendingPathComponent(name)
        }
        return nil
    }

    private static func bundledPythonHome() -> String? {
        guard let resource = Bundle.main.resourceURL else { return nil }
        let home = resource.appendingPathComponent("python").path
        return FileManager.default.fileExists(atPath: home) ? home : nil
    }

    private static func parsePercent(_ line: String) -> Int? {
        guard line.contains("[download]") else { return nil }
        let pattern = #"(\d+(?:\.\d+)?)\s*%"#
        guard let match = line.range(of: pattern, options: .regularExpression) else { return nil }
        let token = String(line[match]).replacingOccurrences(of: "%", with: "")
        return Int(Double(token) ?? 0)
    }
}