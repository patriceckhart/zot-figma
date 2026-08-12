package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"sync"
	"time"
)

const (
	name    = "figma"
	version = "0.1.0"
	address = "127.0.0.1:38451"
)

type frame map[string]any

type command struct {
	ID        string          `json:"id"`
	Operation string          `json:"operation"`
	Args      json.RawMessage `json:"args"`
}

type pluginResult struct {
	ID       string          `json:"id"`
	OK       bool            `json:"ok"`
	Data     json.RawMessage `json:"data,omitempty"`
	Error    string          `json:"error,omitempty"`
	MimeType string          `json:"mimeType,omitempty"`
	Base64   string          `json:"base64,omitempty"`
}

type bridge struct {
	commands chan command
	mu       sync.Mutex
	waiters  map[string]chan pluginResult
	lastPoll time.Time
}

func newBridge() *bridge {
	return &bridge{commands: make(chan command, 32), waiters: make(map[string]chan pluginResult)}
}

func (b *bridge) connected() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return time.Since(b.lastPoll) < 8*time.Second
}

func (b *bridge) execute(id, operation string, args json.RawMessage) (pluginResult, error) {
	response := make(chan pluginResult, 1)
	b.mu.Lock()
	b.waiters[id] = response
	b.mu.Unlock()
	defer func() {
		b.mu.Lock()
		delete(b.waiters, id)
		b.mu.Unlock()
	}()

	select {
	case b.commands <- command{ID: id, Operation: operation, Args: args}:
	case <-time.After(3 * time.Second):
		return pluginResult{}, errors.New("Figma command queue is full")
	}

	select {
	case result := <-response:
		return result, nil
	case <-time.After(55 * time.Second):
		return pluginResult{}, errors.New("timed out waiting for the Figma plugin")
	}
}

func cors(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "content-type")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next(w, r)
	}
}

func (b *bridge) serve() *http.Server {
	mux := http.NewServeMux()
	mux.HandleFunc("/poll", cors(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		b.mu.Lock()
		b.lastPoll = time.Now()
		b.mu.Unlock()
		select {
		case cmd := <-b.commands:
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(cmd)
		case <-r.Context().Done():
		case <-time.After(2 * time.Second):
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, "{}\n")
		}
	}))
	mux.HandleFunc("/result", cors(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var result pluginResult
		if err := json.NewDecoder(io.LimitReader(r.Body, 50<<20)).Decode(&result); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		b.mu.Lock()
		waiter := b.waiters[result.ID]
		b.mu.Unlock()
		if waiter != nil {
			waiter <- result
		}
		w.WriteHeader(http.StatusNoContent)
	}))

	server := &http.Server{Addr: address, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("bridge server: %v", err)
		}
	}()
	return server
}

var tools = []frame{
	{"name": "figma_status", "description": "Check whether the local Figma/FigJam plugin bridge is connected and ready.", "schema": frame{"type": "object", "properties": frame{}}},
	{"name": "figma_read", "description": "Read structured data from the open Figma Design or FigJam file. Read the selection by default, a node by ID, the current page, or a shallow document tree.", "schema": frame{"type": "object", "properties": frame{"target": frame{"type": "string", "enum": []string{"selection", "page", "document", "node"}}, "nodeId": frame{"type": "string"}, "depth": frame{"type": "integer", "minimum": 0, "maximum": 8}}, "additionalProperties": false}},
	{"name": "figma_create", "description": "Create one or more nodes in the open Figma Design or FigJam file. Supports FRAME, TEXT, RECTANGLE, ELLIPSE, LINE, COMPONENT, INSTANCE, SECTION, STICKY, SHAPE_WITH_TEXT, and CONNECTOR. Children may be nested. Use parentId or the current page is used.", "schema": frame{"type": "object", "properties": frame{"parentId": frame{"type": "string"}, "nodes": frame{"type": "array", "items": frame{"type": "object"}, "minItems": 1}}, "required": []string{"nodes"}, "additionalProperties": false}},
	{"name": "figma_update", "description": "Update Figma/FigJam nodes. Each update needs id and may set name, x, y, width, height, rotation, opacity, visible, locked, text, fills, strokes, cornerRadius, layoutMode, spacing, padding, constraints, component properties, or connector endpoints.", "schema": frame{"type": "object", "properties": frame{"updates": frame{"type": "array", "items": frame{"type": "object"}, "minItems": 1}}, "required": []string{"updates"}, "additionalProperties": false}},
	{"name": "figma_delete", "description": "Delete nodes from the open Figma/FigJam file.", "schema": frame{"type": "object", "properties": frame{"nodeIds": frame{"type": "array", "items": frame{"type": "string"}, "minItems": 1}}, "required": []string{"nodeIds"}, "additionalProperties": false}},
	{"name": "figma_select", "description": "Select nodes on the current page and optionally scroll/zoom them into view.", "schema": frame{"type": "object", "properties": frame{"nodeIds": frame{"type": "array", "items": frame{"type": "string"}}, "zoom": frame{"type": "boolean"}}, "required": []string{"nodeIds"}, "additionalProperties": false}},
	{"name": "figma_export", "description": "Export a Figma node and return the rendered image or document. PNG is best when visual inspection is needed.", "schema": frame{"type": "object", "properties": frame{"nodeId": frame{"type": "string"}, "format": frame{"type": "string", "enum": []string{"PNG", "JPG", "SVG", "PDF"}}, "scale": frame{"type": "number", "minimum": 0.1, "maximum": 4}}, "required": []string{"nodeId"}, "additionalProperties": false}},
}

func send(writer *bufio.Writer, value any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if _, err = writer.Write(append(data, '\n')); err != nil {
		return err
	}
	return writer.Flush()
}

func textResult(id, text string, isError bool) frame {
	result := frame{"type": "tool_result", "id": id, "content": []frame{{"type": "text", "text": text}}}
	if isError {
		result["is_error"] = true
	}
	return result
}

func main() {
	log.SetOutput(os.Stderr)
	out := bufio.NewWriter(os.Stdout)
	if err := send(out, frame{"type": "hello", "name": name, "version": version, "capabilities": []string{"tools"}}); err != nil {
		log.Fatal(err)
	}

	b := newBridge()
	server := b.serve()
	defer server.Close()

	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 64<<10), 16<<20)
	for scanner.Scan() {
		var incoming frame
		if err := json.Unmarshal(scanner.Bytes(), &incoming); err != nil {
			log.Printf("invalid frame: %v", err)
			continue
		}
		switch incoming["type"] {
		case "hello_ack":
			for _, tool := range tools {
				registration := frame{"type": "register_tool"}
				for key, value := range tool {
					registration[key] = value
				}
				_ = send(out, registration)
			}
			_ = send(out, frame{"type": "ready"})
		case "tool_call":
			id, _ := incoming["id"].(string)
			toolName, _ := incoming["name"].(string)
			args, _ := json.Marshal(incoming["args"])
			if toolName == "figma_status" {
				state := "not connected. Start the development plugin named 'zot bridge' in the target Figma file and leave it open."
				if b.connected() {
					state = "connected and ready"
				}
				_ = send(out, textResult(id, "Figma bridge is "+state, false))
				continue
			}
			if !b.connected() {
				_ = send(out, textResult(id, "Figma plugin is not connected. Run the development plugin named 'zot bridge' in the target Figma Design or FigJam file and leave it open.", true))
				continue
			}
			result, err := b.execute(id, toolName, args)
			if err != nil {
				_ = send(out, textResult(id, err.Error(), true))
				continue
			}
			if !result.OK {
				_ = send(out, textResult(id, result.Error, true))
				continue
			}
			if result.Base64 != "" {
				content := []frame{{"type": "image", "mime_type": result.MimeType, "data": result.Base64}}
				if result.MimeType == "image/svg+xml" || result.MimeType == "application/pdf" {
					content = []frame{{"type": "text", "text": fmt.Sprintf("Export complete (%s, base64): %s", result.MimeType, result.Base64)}}
				}
				_ = send(out, frame{"type": "tool_result", "id": id, "content": content})
				continue
			}
			text := string(result.Data)
			if text == "" || text == "null" {
				text = "Operation completed."
			}
			_ = send(out, textResult(id, text, false))
		case "shutdown":
			_ = send(out, frame{"type": "shutdown_ack"})
			return
		}
	}
	if err := scanner.Err(); err != nil {
		log.Printf("stdin: %v", err)
	}
}
