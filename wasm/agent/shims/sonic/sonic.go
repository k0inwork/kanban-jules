// Package sonic is a WASM-compatible shim for bytedance/sonic.
// It delegates to encoding/json and provides the subset of API used by Eino.
package sonic

import (
	"encoding/json"
	"io"
)

const (
	UseStdJSON   = 0
	UseSonicJSON = UseStdJSON
)

func Marshal(v interface{}) ([]byte, error)     { return json.Marshal(v) }
func Unmarshal(data []byte, v interface{}) error { return json.Unmarshal(data, v) }

func MarshalString(v interface{}) (string, error) {
	b, err := json.Marshal(v)
	return string(b), err
}

func UnmarshalString(data string, v interface{}) error {
	return json.Unmarshal([]byte(data), v)
}

func GetFromString(data string, path ...interface{}) (Node, error) {
	var v interface{}
	if err := json.Unmarshal([]byte(data), &v); err != nil {
		return Node{}, err
	}
	cur := v
	for _, p := range path {
		switch idx := p.(type) {
		case string:
			m, ok := cur.(map[string]interface{})
			if !ok {
				return Node{}, nil
			}
			cur = m[idx]
		case int:
			arr, ok := cur.([]interface{})
			if !ok {
				return Node{}, nil
			}
			if idx >= len(arr) {
				return Node{}, nil
			}
			cur = arr[idx]
		}
	}
	b, _ := json.Marshal(cur)
	return Node{raw: string(b)}, nil
}

func NewEncoder(w io.Writer) *json.Encoder { return json.NewEncoder(w) }
func NewDecoder(r io.Reader) *json.Decoder { return json.NewDecoder(r) }

// Node is a minimal shim for sonic/ast.Node
type Node struct {
	raw string
}

func (n Node) MarshalJSON() ([]byte, error) { return []byte(n.raw), nil }
func (n Node) Raw() string                   { return n.raw }

// Options stub
type Options int

func (o Options) MarshalString(v interface{}) (string, error) {
	b, err := json.Marshal(v)
	return string(b), err
}

func (o Options) UnmarshalString(data string, v interface{}) error {
	return json.Unmarshal([]byte(data), v)
}

var ConfigStd Options
var ConfigFastest Options
