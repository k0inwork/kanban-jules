// Package ast is a WASM shim for sonic/ast.Node
package ast

import "encoding/json"

type Node struct {
	raw string
}

func (n Node) MarshalJSON() ([]byte, error) { return []byte(n.raw), nil }
func (n Node) Raw() string                   { return n.raw }

func NewRaw(str string) Node { return Node{raw: str} }

func (n Node) Interface() (interface{}, error) {
	var v interface{}
	err := json.Unmarshal([]byte(n.raw), &v)
	return v, err
}
