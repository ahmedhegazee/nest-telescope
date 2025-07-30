/// <reference types="jest" />
/// <reference types="node" />

// Jest setup file for telescope package tests
import 'reflect-metadata';

// Global test timeout
jest.setTimeout(10000);

// Mock process.env for tests
process.env.NODE_ENV = 'test';
process.env.TELESCOPE_ENVIRONMENT = 'test';
