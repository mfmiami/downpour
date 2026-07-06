//
//  AppDelegate.swift
//  macOS (App)
//
//  Created by Frank Gardner on 6/17/26.
//

import Cocoa

@main
class AppDelegate: NSObject, NSApplicationDelegate {

    func applicationDidFinishLaunching(_ notification: Notification) {
        YoutubeJobRunner.shared.start()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return !YoutubeJobRunner.shared.hasActiveJobs()
    }

}