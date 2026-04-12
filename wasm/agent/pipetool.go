package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"github.com/cloudwego/eino/components/tool"
	"github.com/cloudwego/eino/schema"
)

const (
	toolsListPath  = "/tools/list"
	toolsCallPath  = "/tools/call"
	toolsResultPath = "/tools/result"
)

// PipeTool implements tool.InvokableTool by calling through the /tools/ filesystem.
// Tool definitions come from reading /tools/list, execution goes to /tools/call.
type PipeTool struct {
	info *schema.ToolInfo
}

func NewPipeTool(info *schema.ToolInfo) *PipeTool {
	return &PipeTool{info: info}
}

// Info returns the tool definition.
func (t *PipeTool) Info(ctx context.Context) (*schema.ToolInfo, error) {
	return t.info, nil
}

// InvokableRun calls the tool via /tools/ filesystem and returns the result string.
func (t *PipeTool) InvokableRun(ctx context.Context, argumentsInJSON string, opts ...tool.Option) (string, error) {
	// Build the call payload: {"name": "...", "params": {...}}
	var params map[string]interface{}
	if err := json.Unmarshal([]byte(argumentsInJSON), &params); err != nil {
		params = map[string]interface{}{}
	}

	callPayload, err := json.Marshal(map[string]interface{}{
		"name":   t.info.Name,
		"params": params,
	})
	if err != nil {
		return "", fmt.Errorf("marshal call payload: %w", err)
	}

	// Write to /tools/call (Close triggers the tool call synchronously)
	if err := os.WriteFile(toolsCallPath, callPayload, 0222); err != nil {
		return "", fmt.Errorf("write call: %w", err)
	}

	// Read result from /tools/result
	resultBytes, err := os.ReadFile(toolsResultPath)
	if err != nil {
		return "", fmt.Errorf("read result: %w", err)
	}

	// Parse the result: {"content": "...", "error": ""}
	var result struct {
		Content string `json:"content"`
		Error   string `json:"error"`
	}
	if err := json.Unmarshal(resultBytes, &result); err != nil {
		return string(resultBytes), nil
	}

	if result.Error != "" {
		return "", fmt.Errorf("tool error: %s", result.Error)
	}

	return result.Content, nil
}

// loadToolsFromPipe reads /tools/list and creates PipeTool instances.
func loadToolsFromPipe() ([]*PipeTool, error) {
	data, err := os.ReadFile(toolsListPath)
	if err != nil {
		return nil, fmt.Errorf("read tools list: %w", err)
	}

	var defs []struct {
		Name        string `json:"name"`
		Description string `json:"desc"`
		Params      map[string]struct {
			Type        string `json:"type"`
			Description string `json:"description"`
			Required    bool   `json:"required"`
		} `json:"params"`
	}
	if err := json.Unmarshal(data, &defs); err != nil {
		return nil, fmt.Errorf("parse tool defs: %w", err)
	}

	tools := make([]*PipeTool, 0, len(defs))
	for _, d := range defs {
		params := make(map[string]*schema.ParameterInfo)
		for k, p := range d.Params {
			params[k] = &schema.ParameterInfo{
				Type: schema.DataType(p.Type),
				Desc: p.Description,
			}
		}
		var paramsOneOf *schema.ParamsOneOf
		if len(params) > 0 {
			paramsOneOf = schema.NewParamsOneOfByParams(params)
		}
		tools = append(tools, NewPipeTool(&schema.ToolInfo{
			Name:        d.Name,
			Desc:        d.Description,
			ParamsOneOf: paramsOneOf,
		}))
	}

	return tools, nil
}

var _ tool.InvokableTool = (*PipeTool)(nil)
