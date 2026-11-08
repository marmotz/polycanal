import '@angular/compiler';
import { getTestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { afterEach } from 'vitest';

getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());

// Jasmine and Jest integrations reset TestBed automatically, Vitest needs it explicitly
afterEach(() => getTestBed().resetTestingModule());
