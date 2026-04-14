//go:build js || wasip1 || windows

package pstat

func SysToStat(sys any) *Stat {
	if st, ok := sys.(*Stat); ok {
		return st
	}
	return &Stat{Nlink: 1}
}

func StatToSys(stat *Stat) any {
	return stat
}
